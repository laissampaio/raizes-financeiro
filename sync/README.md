# Raízes Sync (Google Sheets → Supabase)

Script que sincroniza diariamente os dados da planilha financeira da Raízes
Desenvolvimento Sustentável com um banco Supabase, para servir de fonte de
dados para dashboards (Power BI, etc.) sem depender de chamadas diretas à
planilha.

Não tem relação com o frontend (`/src`) deste repositório — é um backend
independente, deployado separadamente (ex.: Railway com cron diário).

## Setup local

1. Crie um virtualenv e instale as dependências:

   ```bash
   cd sync
   python -m venv .venv
   .venv\Scripts\activate          # Windows
   # source .venv/bin/activate     # Linux/Mac
   pip install -r requirements.txt
   ```

2. No Supabase, abra o **SQL Editor** e rode o conteúdo de
   [`schema.sql`](schema.sql) para criar as tabelas.

3. Copie `.env.example` para `.env` e preencha:
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API)
   - `GOOGLE_SHEETS_ID` (já vem preenchido com o ID da planilha da Raízes)

4. Crie uma service account no Google Cloud Console com acesso à API do
   Google Sheets, baixe o JSON e salve como `sync/service_account.json`.
   **Adicione o e-mail da service account como Leitor na planilha do
   Google Sheets** (Compartilhar > colar o e-mail `...@...iam.gserviceaccount.com`).

5. Rode o sync:

   ```bash
   python sync.py
   ```

## Deploy no Railway (cron diário)

O [`railway.toml`](railway.toml) já configura o cron (`0 6 * * *`, todo dia
às 6h) e o comando de start.

1. Crie um projeto novo no Railway apontando para este repositório, com
   **root directory = `sync`** (Settings > Root Directory).
2. Configure as variáveis de ambiente no Railway:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_SERVICE_ACCOUNT_BASE64` — o JSON da service account em base64
     (o Railway não tem filesystem persistente entre deploys, então o
     arquivo não pode ser commitado nem copiado manualmente). Gere com:

     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("service_account.json"))
     ```

     ```bash
     base64 -w0 service_account.json
     ```

3. Deploy. O Railway vai rodar `python sync.py` automaticamente no horário
   configurado.

## Estrutura

- `sync.py` — script principal: lê as abas da planilha, resolve dimensões
  (criando registros novos quando necessário) e substitui as tabelas de
  fato no Supabase.
- `schema.sql` — DDL das tabelas (`dim_*` e `fact_*`).
- `requirements.txt` — dependências Python.
- `railway.toml` — config de deploy/cron no Railway.
- `.env.example` — template de variáveis de ambiente.

## Notas

- `service_account.json` e `.env` nunca são commitados (ver `.gitignore`
  na raiz do repositório).
- O script é idempotente: tabelas de fato são recriadas do zero a cada
  execução (delete + insert em lotes de 500); dimensões usam upsert.
- Erros em uma etapa (ex.: aba não encontrada) são logados e não impedem
  as demais etapas de rodar — o script só sai com código de erro (`exit 1`)
  se alguma etapa falhou.
