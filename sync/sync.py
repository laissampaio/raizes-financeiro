"""Sincroniza a planilha Google Sheets da Raízes DS com o Supabase.

Roda do zero a cada execução: lê as abas relevantes, resolve as dimensões
(criando registros novos quando necessário) e substitui o conteúdo das
tabelas de fato. Idempotente — duas execuções seguidas com os mesmos dados
na planilha produzem o mesmo resultado no banco.
"""

import base64
import logging
import os
import re
import sys
import time
import traceback
import unicodedata
from datetime import date, datetime, timedelta

from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
from supabase import Client, create_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("raizes-sync")

SHEETS_ID = os.environ["GOOGLE_SHEETS_ID"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

ABA_LANCAMENTOS = "Lançamentos"
ABA_PROPOSTAS = "Proposta dos Projetos"
ABA_FLUXO = "Fluxo Previsto 2026"
ABA_IMPOSTOS = "Impostos"
ABA_APLICACAO = "Aplicação"

INSERT_BATCH_SIZE = 500


# --------------------------------------------------------------------------
# Helpers de transformação
# --------------------------------------------------------------------------

def normalize_name(value):
    """Remove espaços extras e normaliza para comparação/armazenamento."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _normalize_header(value):
    """Normaliza nomes de coluna pra comparação: ignora acento, maiúscula e
    todo espaço em branco — a planilha real tem inconsistências de
    espaçamento (ex.: "Pagador/ Favorecido" com espaço depois da barra)."""
    texto = str(value or "").strip().lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", "", texto)


def get_col(row, nome):
    """Busca o valor de uma coluna por nome, ignorando acento/maiúsculas."""
    alvo = _normalize_header(nome)
    for chave, valor in row.items():
        if _normalize_header(chave) == alvo:
            return valor
    return ""


def parse_decimal(value):
    """Converte "R$ 1.234,56" / "-4.290,00" / 1234.56 para float (ou None)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    raw = str(value).strip()
    if raw == "":
        return None

    negativo_parenteses = raw.startswith("(") and raw.endswith(")")
    limpo = raw.strip("()")
    limpo = re.sub(r"R\$\s?", "", limpo, flags=re.IGNORECASE).strip()
    limpo = limpo.rstrip("%").strip()
    limpo = limpo.replace(".", "").replace(",", ".")

    try:
        numero = float(limpo)
    except ValueError:
        return None

    return -abs(numero) if negativo_parenteses else numero


def parse_date_dmy(value):
    """Converte datas para date (ou None se vazio/inválido).

    Aceita:
    - "DD/MM/YYYY" ou "DD/MM/YY" (formato brasileiro)
    - Serial numérico do Google Sheets (epoch 30/12/1899), retornado
      pela Sheets API quando as células não têm formato de data explícito
    """
    raw = str(value or "").strip()
    if raw == "":
        return None

    # Formato texto DD/MM/YYYY ou DD/MM/YY
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", raw)
    if match:
        dia, mes, ano = match.groups()
        ano = f"20{ano}" if len(ano) == 2 else ano
        try:
            return date(int(ano), int(mes), int(dia))
        except ValueError:
            return None

    # Serial numérico do Google Sheets (epoch: 30/12/1899)
    if re.match(r"^\d+\.?\d*$", raw):
        try:
            serial = int(float(raw))
            if 1000 <= serial <= 200000:
                return date(1899, 12, 30) + timedelta(days=serial)
        except (ValueError, OverflowError):
            pass

    return None


def parse_date_my(value):
    """Converte "MM/YY" para o primeiro dia do mês (ou None)."""
    raw = str(value or "").strip()
    if raw == "":
        return None

    match = re.match(r"^(\d{1,2})/(\d{2,4})$", raw)
    if not match:
        return None

    mes, ano = match.groups()
    ano = f"20{ano}" if len(ano) == 2 else ano
    try:
        return date(int(ano), int(mes), 1)
    except ValueError:
        return None


def parse_bool_sim_nao(value):
    return normalize_name(value).lower() in ("sim", "true", "1", "x")


# --------------------------------------------------------------------------
# Leitura da planilha
# --------------------------------------------------------------------------

class SheetsReader:
    def __init__(self, sheets_id):
        self.sheets_id = sheets_id
        self._service = self._build_service()
        self._titulos = None

    def _build_service(self):
        base64_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_BASE64")
        if base64_creds:
            import json
            import tempfile

            # Strip whitespace/newlines and fix padding before decoding
            cleaned = base64_creds.strip().replace('\n', '').replace('\r', '').replace(' ', '')
            cleaned += '=' * (-len(cleaned) % 4)
            info = json.loads(base64.b64decode(cleaned))
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
            )
        else:
            arquivo = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json")
            creds = service_account.Credentials.from_service_account_file(
                arquivo, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
            )
        return build("sheets", "v4", credentials=creds)

    def titulos_abas(self):
        if self._titulos is None:
            resp = (
                self._service.spreadsheets()
                .get(spreadsheetId=self.sheets_id, fields="sheets.properties.title")
                .execute()
            )
            self._titulos = [s["properties"]["title"] for s in resp.get("sheets", [])]
        return self._titulos

    def encontrar_aba(self, esperado):
        alvo = _normalize_header(esperado)
        for titulo in self.titulos_abas():
            if _normalize_header(titulo) == alvo:
                return titulo
        return None

    def ler_range(self, aba, range_a1=None):
        """Lê um range como lista de listas (valores brutos)."""
        nome_real = self.encontrar_aba(aba)
        if nome_real is None:
            raise ValueError(f'Aba "{aba}" não encontrada na planilha.')

        ref = f"'{nome_real}'!{range_a1}" if range_a1 else f"'{nome_real}'"
        resp = (
            self._service.spreadsheets()
            .values()
            .get(spreadsheetId=self.sheets_id, range=ref)
            .execute()
        )
        return resp.get("values", [])


def localizar_linha_cabecalho(values, esperadas, max_linhas=5):
    """Acha a linha com mais correspondências de cabeçalho esperado."""
    melhor_indice, melhor_pontuacao = 0, -1
    for i in range(min(max_linhas, len(values))):
        linha = [_normalize_header(c) for c in values[i]]
        pontuacao = sum(1 for e in esperadas if _normalize_header(e) in linha)
        if pontuacao > melhor_pontuacao:
            melhor_indice, melhor_pontuacao = i, pontuacao
    return melhor_indice


def linhas_como_dicts(values, esperadas=None):
    """Mapeia linhas brutas (lista de listas) em dicts por nome de cabeçalho."""
    if not values:
        return []

    indice = localizar_linha_cabecalho(values, esperadas) if esperadas else 0
    cabecalho = [str(h or "").strip() for h in values[indice]]
    linhas = values[indice + 1 :]

    resultado = []
    for row in linhas:
        if not any(str(c or "").strip() for c in row):
            # Linha totalmente vazia encerra a tabela — algumas abas têm uma
            # tabela auxiliar não relacionada mais abaixo, nas mesmas
            # colunas (ex.: "Proposta dos Projetos"!N:P tem um calculador de
            # qtd/valor depois da lista de projetos).
            break
        item = {}
        for i, nome_col in enumerate(cabecalho):
            if nome_col == "":
                continue
            item[nome_col] = row[i] if i < len(row) else ""
        resultado.append(item)
    return resultado


# --------------------------------------------------------------------------
# Cache de chaves estrangeiras (evita reconsultar o Supabase repetidamente)
# --------------------------------------------------------------------------

class FKCache:
    def __init__(self, db: Client):
        self.db = db
        self._projetos = {}
        self._categorias = {}
        self._pessoas = {}
        self._aliases = {}
        self.pessoas_criadas = 0
        self._carregar_aliases()

    def _carregar_aliases(self):
        """Carrega a tabela dim_projeto_alias para normalizar nomes de projeto."""
        try:
            resp = self.db.table("dim_projeto_alias").select("alias,nome_canonical").execute()
            for row in resp.data:
                self._aliases[normalize_name(row["alias"])] = row["nome_canonical"]
            log.info("dim_projeto_alias: %d alias(es) carregado(s)", len(self._aliases))
        except Exception as e:
            log.warning("Não foi possível carregar dim_projeto_alias: %s", e)

    def get_projeto_id(self, nome):
        """Busca o projeto pelo nome na lista mestra (dim_projeto).

        Aplica dim_projeto_alias antes da busca, normalizando variações de
        grafia (ex.: "Sta Barbara" → "Santa Barbara 26"). Não cria projetos
        novos — só sync_projetos tem autoridade pra isso.
        """
        nome = normalize_name(nome)
        if nome == "":
            return None

        # Aplica alias se existir
        nome_canonical = self._aliases.get(nome, nome)

        if nome_canonical in self._projetos:
            return self._projetos[nome_canonical]

        resp = self.db.table("dim_projeto").select("id").eq("nome", nome_canonical).limit(1).execute()
        if not resp.data:
            log.warning('Projeto "%s" não está na lista mestra — projeto_id ficará nulo', nome_canonical)
            self._projetos[nome_canonical] = None
            return None

        projeto_id = resp.data[0]["id"]
        self._projetos[nome_canonical] = projeto_id
        return projeto_id

    def get_categoria_id(self, categoria, detalhamento, detalhamento_p):
        categoria = normalize_name(categoria)
        detalhamento = normalize_name(detalhamento)
        detalhamento_p = normalize_name(detalhamento_p)
        chave = (categoria, detalhamento, detalhamento_p)
        if chave in self._categorias:
            return self._categorias[chave]

        query = self.db.table("dim_categoria").select("id").eq("categoria", categoria)
        query = query.eq("detalhamento", detalhamento).eq("detalhamento_p", detalhamento_p)
        resp = query.limit(1).execute()
        if resp.data:
            categoria_id = resp.data[0]["id"]
        else:
            payload = {
                "categoria": categoria,
                "detalhamento": detalhamento,
                "detalhamento_p": detalhamento_p,
            }
            resp = self.db.table("dim_categoria").insert(payload).execute()
            categoria_id = resp.data[0]["id"]

        self._categorias[chave] = categoria_id
        return categoria_id

    def get_pessoa_id(self, nome):
        nome = normalize_name(nome)
        if nome == "":
            return None
        if nome in self._pessoas:
            return self._pessoas[nome]

        resp = self.db.table("dim_pessoa").select("id").eq("nome", nome).limit(1).execute()
        if resp.data:
            pessoa_id = resp.data[0]["id"]
        else:
            resp = self.db.table("dim_pessoa").insert({"nome": nome}).execute()
            pessoa_id = resp.data[0]["id"]
            self.pessoas_criadas += 1
            log.warning('Pessoa nova criada automaticamente: "%s"', nome)

        self._pessoas[nome] = pessoa_id
        return pessoa_id


def _iso(d):
    return d.isoformat() if isinstance(d, date) else None


# --------------------------------------------------------------------------
# dim_data: garante que toda data usada nas fatos exista na dimensão
# --------------------------------------------------------------------------

MESES_PT = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]


def upsert_dim_data(db: Client, datas):
    datas_unicas = sorted({d for d in datas if d is not None})
    if not datas_unicas:
        return 0

    registros = [
        {
            "data": d.isoformat(),
            "ano": d.year,
            "mes": d.month,
            "trimestre": (d.month - 1) // 3 + 1,
            "mes_nome": MESES_PT[d.month - 1],
            "semestre": 1 if d.month <= 6 else 2,
        }
        for d in datas_unicas
    ]
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("dim_data").upsert(lote, on_conflict="data").execute()
    return len(registros)


def _em_lotes(lista, tamanho):
    for i in range(0, len(lista), tamanho):
        yield lista[i : i + tamanho]


# --------------------------------------------------------------------------
# Sync por tabela
# --------------------------------------------------------------------------

def sync_projetos(db: Client, reader: SheetsReader):
    """dim_projeto a partir do bloco N:P da aba de propostas (lista mestra)."""
    values = reader.ler_range(ABA_PROPOSTAS, "N:P")
    linhas = linhas_como_dicts(values, ["Nome Projeto", "Data Inicio", "Data Final"])

    por_nome = {}
    for linha in linhas:
        nome = normalize_name(get_col(linha, "Nome Projeto"))
        if nome == "":
            continue
        por_nome[nome] = {
            "nome": nome,
            "data_inicio": _iso(parse_date_my(get_col(linha, "Data Inicio"))),
            "data_fim": _iso(parse_date_my(get_col(linha, "Data Final"))),
        }

    registros = list(por_nome.values())
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("dim_projeto").upsert(lote, on_conflict="nome").execute()

    log.info("dim_projeto: %d registro(s) sincronizado(s)", len(registros))
    return registros


def sync_aliquotas(db: Client, reader: SheetsReader):
    values = reader.ler_range(ABA_IMPOSTOS)
    linhas = linhas_como_dicts(values, ["Ano", "Mês", "Alíquota"])

    por_chave = {}
    for linha in linhas:
        ano = get_col(linha, "Ano")
        mes = get_col(linha, "Mês")
        if str(ano).strip() == "" or str(mes).strip() == "":
            continue
        aliquota = parse_decimal(get_col(linha, "Alíquota"))
        try:
            chave = (int(float(ano)), int(float(mes)))
        except ValueError:
            log.warning('Linha de alíquota ignorada (ano/mês inválido): %r', linha)
            continue
        if aliquota is None:
            log.warning("Alíquota sem valor para %s/%s, linha ignorada", chave[1], chave[0])
            continue
        por_chave[chave] = {"ano": chave[0], "mes": chave[1], "aliquota_pct": aliquota}

    registros = list(por_chave.values())
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("dim_aliquota").upsert(lote, on_conflict="ano,mes").execute()

    log.info("dim_aliquota: %d registro(s) sincronizado(s)", len(registros))
    return registros


def sync_orcamento(db: Client, reader: SheetsReader, fk: FKCache):
    """fact_orcamento_linhas a partir do bloco A:I da aba de propostas."""
    values = reader.ler_range(ABA_PROPOSTAS, "A:I")
    linhas = linhas_como_dicts(values, ["Nome Projeto", "Valor Total"])

    registros = []
    for linha in linhas:
        nome_projeto = normalize_name(get_col(linha, "Nome Projeto"))
        if nome_projeto == "":
            continue

        projeto_id = fk.get_projeto_id(nome_projeto)
        categoria_id = fk.get_categoria_id(
            get_col(linha, "Categoria"), get_col(linha, "Detalhamento"), ""
        )

        registros.append(
            {
                "projeto_id": projeto_id,
                "categoria_id": categoria_id,
                "qtd_dias": parse_decimal(get_col(linha, "qtd/dias")),
                "qtd_8h": parse_decimal(get_col(linha, "qtd/8")),
                "valor_unitario": parse_decimal(get_col(linha, "Valor Unitário")),
                "valor_total": parse_decimal(get_col(linha, "Valor Total")),
                "obs1": normalize_name(get_col(linha, "Observação 1")) or None,
                "obs2": normalize_name(get_col(linha, "Observação 2")) or None,
            }
        )

    db.table("fact_orcamento_linhas").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("fact_orcamento_linhas").insert(lote).execute()

    log.info("fact_orcamento_linhas: %d registro(s) sincronizado(s)", len(registros))
    return registros


def sync_lancamentos(db: Client, reader: SheetsReader, fk: FKCache):
    values = reader.ler_range(ABA_LANCAMENTOS)
    esperadas = ["Data", "Categoria", "Detalhamento", "Crédito", "Débito"]

    # A aba Lançamentos tem dois cabeçalhos empilhados separados por uma linha vazia:
    #   Row 0: tem "Data" em col 0, mas "Saldo em" / "31/12/24" nas colunas de valor
    #   Row 1: vazia
    #   Row 2: tem "Crédito"/"Débito" nas colunas de valor, mas "preci" em col 0
    # localizar_linha_cabecalho escolhe row 2 por ter mais matches (Crédito+Débito),
    # deixando "Data" sem cabeçalho e zerando todos os lançamentos.
    # Solução: mesclar os dois cabeçalhos — para cada coluna, preferir o nome da
    # row 2 se for uma coluna esperada; caso contrário usar o nome da row 0.
    if len(values) >= 3 and not values[1]:
        esperadas_norm = {_normalize_header(e) for e in esperadas}
        row0 = values[0]
        row2 = values[2]
        n = max(len(row0), len(row2))
        header = []
        for i in range(n):
            h2 = str(row2[i] if i < len(row2) else "").strip()
            h0 = str(row0[i] if i < len(row0) else "").strip()
            header.append(h2 if _normalize_header(h2) in esperadas_norm else h0)

        linhas = []
        for row in values[3:]:
            if not any(str(c or "").strip() for c in row):
                break
            item = {}
            for i, col_name in enumerate(header):
                if col_name:
                    item[col_name] = row[i] if i < len(row) else ""
            linhas.append(item)
    else:
        linhas = linhas_como_dicts(values, esperadas)

    registros = []
    ignoradas_sem_data = 0
    datas_usadas = []

    for linha in linhas:
        data_lanc = parse_date_dmy(get_col(linha, "Data"))
        if data_lanc is None:
            ignoradas_sem_data += 1
            continue
        datas_usadas.append(data_lanc)

        categoria = normalize_name(get_col(linha, "Categoria"))
        detalhamento = normalize_name(get_col(linha, "Detalhamento"))
        detalhamento_p = normalize_name(get_col(linha, "Detalhamento Projeto"))

        projeto_id = None
        if categoria == "Projetos" and detalhamento != "":
            projeto_id = fk.get_projeto_id(detalhamento)

        categoria_id = fk.get_categoria_id(categoria, detalhamento, detalhamento_p)
        pessoa_id = fk.get_pessoa_id(get_col(linha, "Pagador/Favorecido"))

        registros.append(
            {
                "data": data_lanc.isoformat(),
                "projeto_id": projeto_id,
                "categoria_id": categoria_id,
                "pessoa_id": pessoa_id,
                "tipo_movimento": normalize_name(get_col(linha, "Tipo Movimentação")) or None,
                "descricao": normalize_name(get_col(linha, "Descrição")) or None,
                "credito": parse_decimal(get_col(linha, "Crédito")),
                "debito": parse_decimal(get_col(linha, "Débito")),
                "saldo": parse_decimal(get_col(linha, "Saldo")),
                "pertence_a_mim": parse_bool_sim_nao(get_col(linha, "Pertence a minoria")),
                "tipo_deslocamento": normalize_name(get_col(linha, "Tipo de deslocamento")) or None,
                "km": parse_decimal(get_col(linha, "KM")),
                "origem": normalize_name(get_col(linha, "Origem")) or None,
                "destino": normalize_name(get_col(linha, "Destino")) or None,
                "trecho": _to_int(get_col(linha, "Trecho")),
                "sem_imposto": parse_bool_sim_nao(get_col(linha, "Sem Imposto")),
                "obs": normalize_name(get_col(linha, "OBS")) or None,
                "obs_2": normalize_name(get_col(linha, "OBS_2")) or None,
                "local": normalize_name(get_col(linha, "Local")) or None,
            }
        )

    if ignoradas_sem_data:
        log.warning("fact_lancamentos: %d linha(s) ignorada(s) por não ter data", ignoradas_sem_data)

    upsert_dim_data(db, datas_usadas)

    db.table("fact_lancamentos").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("fact_lancamentos").insert(lote).execute()

    log.info("fact_lancamentos: %d registro(s) sincronizado(s)", len(registros))
    return registros


def _to_int(value):
    raw = str(value or "").strip()
    if raw == "":
        return None
    try:
        return int(float(raw.replace(",", ".")))
    except ValueError:
        return None


def sync_fluxo_previsto(db: Client, reader: SheetsReader, fk: FKCache):
    values = reader.ler_range(ABA_FLUXO)
    esperadas = ["Ordem Fluxo", "Categoria 1", "Categoria 2", "Detalhamento", "Data", "Valor"]
    linhas = linhas_como_dicts(values, esperadas)

    registros = []
    datas_usadas = []
    for linha in linhas:
        data_fluxo = parse_date_dmy(get_col(linha, "Data"))
        if data_fluxo is None:
            continue
        datas_usadas.append(data_fluxo)

        detalhamento = normalize_name(get_col(linha, "Detalhamento"))
        projeto_id = fk.get_projeto_id(detalhamento) if detalhamento else None

        registros.append(
            {
                "data": data_fluxo.isoformat(),
                "projeto_id": projeto_id,
                "ordem_fluxo": _to_int(get_col(linha, "Ordem Fluxo")),
                "categoria_1": normalize_name(get_col(linha, "Categoria 1")) or None,
                "categoria_2": normalize_name(get_col(linha, "Categoria 2")) or None,
                "valor": parse_decimal(get_col(linha, "Valor")),
            }
        )

    upsert_dim_data(db, datas_usadas)

    db.table("fact_fluxo_previsto").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("fact_fluxo_previsto").insert(lote).execute()

    log.info("fact_fluxo_previsto: %d registro(s) sincronizado(s)", len(registros))
    return registros


def sync_aplicacao(db: Client, reader: SheetsReader):
    values = reader.ler_range(ABA_APLICACAO)
    esperadas = ["Ano", "Mês", "Entrada", "Saída", "Saldo Final", "Rendimento"]
    linhas = linhas_como_dicts(values, esperadas)

    por_data = {}
    for linha in linhas:
        ano = str(get_col(linha, "Ano")).strip()
        mes = str(get_col(linha, "Mês")).strip()
        if ano == "" or mes == "":
            continue
        try:
            data_mes = date(int(float(ano)), int(float(mes)), 1)
        except ValueError:
            log.warning("Linha de aplicação ignorada (ano/mês inválido): %r", linha)
            continue

        por_data[data_mes] = {
            "data": data_mes.isoformat(),
            "entrada": parse_decimal(get_col(linha, "Entrada")),
            "saida": parse_decimal(get_col(linha, "Saída")),
            "saldo_final": parse_decimal(get_col(linha, "Saldo Final")),
            "rendimento": parse_decimal(get_col(linha, "Rendimento")),
        }

    registros = list(por_data.values())
    upsert_dim_data(db, por_data.keys())

    for lote in _em_lotes(registros, INSERT_BATCH_SIZE):
        db.table("fact_aplicacao").upsert(lote, on_conflict="data").execute()

    log.info("fact_aplicacao: %d registro(s) sincronizado(s)", len(registros))
    return registros


# --------------------------------------------------------------------------
# Execução principal
# --------------------------------------------------------------------------

PASSOS = [
    ("sync_projetos", sync_projetos, False),
    ("sync_aliquotas", sync_aliquotas, False),
    ("sync_orcamento", sync_orcamento, True),
    ("sync_lancamentos", sync_lancamentos, True),
    ("sync_fluxo_previsto", sync_fluxo_previsto, True),
    ("sync_aplicacao", sync_aplicacao, False),
]


def main():
    inicio = time.monotonic()
    log.info("=== Início do sync Raízes DS ===")

    db = create_client(SUPABASE_URL, SUPABASE_KEY)
    reader = SheetsReader(SHEETS_ID)
    fk = FKCache(db)

    falhas = []
    for nome, funcao, precisa_fk in PASSOS:
        try:
            if precisa_fk:
                funcao(db, reader, fk)
            else:
                funcao(db, reader)
        except Exception:
            falhas.append(nome)
            log.error("Falha em %s:\n%s", nome, traceback.format_exc())

    if fk.pessoas_criadas:
        log.info("Pessoas criadas automaticamente: %d", fk.pessoas_criadas)

    duracao = time.monotonic() - inicio
    if falhas:
        log.error("=== Sync concluído com falhas em: %s (%.1fs) ===", ", ".join(falhas), duracao)
        sys.exit(1)

    log.info("=== Sync concluído com sucesso (%.1fs) ===", duracao)


if __name__ == "__main__":
    main()
