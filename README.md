# Dashboard Financeiro — Raízes Desenvolvimento Sustentável

Web app interno para acompanhar o status financeiro dos projetos da Raízes: lê os
lançamentos e orçamentos de uma planilha Google Sheets privada, manda pro Claude
analisar, e mostra um dashboard visual de quais projetos estão dentro do
orçamento esperado considerando o tempo decorrido.

Sem backend: o React lê a Google Sheets API e chama a API da Anthropic direto do
browser. Hospedagem estática no GitHub Pages, com deploy automático via GitHub
Actions a cada push em `master`.

## Aviso de segurança

A chave da API da Anthropic (`VITE_ANTHROPIC_API_KEY`) fica embutida no bundle
JS publicado — qualquer pessoa que abra o DevTools no site consegue copiá-la,
independente do login Google (o OAuth protege a leitura da planilha, não o
bundle estático). Essa é uma decisão consciente para manter o app 100%
client-side, sem servidor pra manter.

**Antes de publicar**, configure um limite de gasto (spend limit / budget
alert) na [console da Anthropic](https://console.anthropic.com/) pra essa
chave, como mitigação caso ela seja copiada.

## Setup

### 1. Google Cloud Console

1. Criar projeto "Raízes Dashboard" em [console.cloud.google.com](https://console.cloud.google.com/)
2. Ativar **Google Sheets API** e **Google Drive API**
3. Criar credencial → **ID do cliente OAuth** → tipo **Aplicativo da Web**
4. Em "Origens JavaScript autorizadas", adicionar:
   - `http://localhost:5173` (dev)
   - `https://laissampaio.github.io` (produção — só o domínio, sem o
     `/raizes-financeiro/` do final, o Google não aceita path nessa lista)
5. Em "Tela de consentimento OAuth" → adicionar o e-mail da Raízes como
   usuária de teste (enquanto o app não for verificado pelo Google)
6. Copiar o **Client ID** gerado

### 2. Chave da Anthropic

Gerar uma chave em [console.anthropic.com](https://console.anthropic.com/) e
configurar um limite de gasto (ver aviso de segurança acima).

### 3. Variáveis de ambiente

Copiar `.env.example` para `.env` e preencher:

```
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_GOOGLE_SHEETS_ID=1U7-LGnPc9JktExevHyZMTEY8kPcwzI3yf_1hjsRpaTM
```

O ID da planilha é a parte da URL entre `/d/` e `/edit`.

A planilha precisa ter duas abas chamadas exatamente **Lançamentos** e
**Orçamentos**, com as colunas descritas no briefing do projeto (o app lê por
nome de cabeçalho, não por posição fixa — então a ordem das colunas pode
variar, mas os nomes não).

### 4. Rodar localmente

```
npm install
npm run dev
```

Abre em `http://localhost:5173`.

## Deploy (GitHub Pages)

O workflow em [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builda e
publica automaticamente a cada push em `master`. Passos únicos de setup:

1. **Settings → Secrets and variables → Actions → New repository secret**,
   criar os 3 secrets (mesmos nomes do `.env.example`):
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_ANTHROPIC_API_KEY`
   - `VITE_GOOGLE_SHEETS_ID`
2. **Settings → Pages → Source** → selecionar **GitHub Actions**
3. Dar push em `master` (ou rodar o workflow manualmente em **Actions →
   Deploy to GitHub Pages → Run workflow**)
4. Depois do primeiro deploy, o site fica em
   `https://laissampaio.github.io/raizes-financeiro/`. Adicionar essa origem
   no Client ID OAuth (passo 1.4) se ainda não tiver feito.

Mudar qualquer um dos 3 secrets depois exige rodar o workflow de novo (push
vazio ou "Run workflow" manual) — o valor é embutido no build, não lido em
runtime.

## Estrutura

```
src/
  lib/
    parse.js        — parsers de moeda/data em pt-BR, helper de leitura por coluna
    auth.js          — guarda o access_token do Google na sessão (sessionStorage)
    sheets.js        — le as duas abas da planilha
    claude.js        — monta o prompt e chama a API da Anthropic
    alertaConfig.js  — cores e labels por tipo de alerta
  components/        — HeaderTopo, SumarioTopo, FiltrosBotoes, CardProjeto, ErrorBanner
```
