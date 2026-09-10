# Deploy — Raízes Dashboard
**URL final:** `https://1secondtask.com/raizes-financeiro`

---

## Arquivos

| Arquivo | Função |
|---|---|
| `raizes_dashboard.html` | Dashboard completo (frontend) |
| `server.py` | API de atualização (FastAPI) |
| `extract.py` | Pipeline de extração de dados |
| `requirements.txt` | Dependências Python do servidor |
| `render.yaml` | Configuração do Render |

---

## Passo 1 — Servidor de atualização (Render)

### 1.1 Criar repositório GitHub
```bash
mkdir raizes-api && cd raizes-api
cp server.py extract.py requirements.txt render.yaml .gitignore ./
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/SEU_USUARIO/raizes-api
git push -u origin main
```

### 1.2 Deploy no Render
1. Acesse https://render.com → "New Web Service"
2. Conecte o repositório `raizes-api`
3. Render detecta o `render.yaml` automaticamente
4. Adicione as variáveis de ambiente manualmente no painel do Render:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → cole o conteúdo completo do arquivo JSON da service account
   - `DASHBOARD_PASSWORD` → escolha uma senha forte (ex: `Raizes@2026!`)
5. Clique em "Create Web Service"
6. Aguarde o deploy (~2 min). A URL será algo como:
   `https://raizes-dashboard-api.onrender.com`

### 1.3 Atualizar URL no dashboard
No `raizes_dashboard.html`, localize a linha:
```js
const API_URL = 'https://raizes-dashboard-api.onrender.com';
```
Substitua pela URL real gerada pelo Render.

### 1.4 Configurar senha offline (hash)
Gere o SHA-256 da senha escolhida:
```bash
echo -n "SUA_SENHA" | sha256sum
```
No `raizes_dashboard.html`, substitua `%%PASSWORD_HASH%%` pelo hash gerado (sem o ` -` do final).

---

## Passo 2 — Dashboard no S3 + CloudFront

### 2.1 Upload para S3
```bash
aws s3 cp raizes_dashboard.html s3://SEU-BUCKET/raizes-financeiro/index.html \
  --content-type "text/html" \
  --cache-control "no-cache, no-store, must-revalidate"
```

### 2.2 Configurar CloudFront
No console AWS → CloudFront → sua distribuição:

1. **Origins**: confirme que aponta para o bucket S3 correto
2. **Behaviors**: adicione um novo behavior:
   - Path pattern: `/raizes-financeiro*`
   - Origin: o mesmo bucket S3
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Cache policy: CachingDisabled (para sempre buscar o HTML mais recente)
3. **Error pages**: adicione regra para 403/404 → `/raizes-financeiro/index.html` → 200
4. Clique em "Save changes" e aguarde a propagação (~5 min)

### 2.3 Testar
Acesse `https://1secondtask.com/raizes-financeiro` — deve aparecer a tela de senha.

---

## Passo 3 — CORS (ajuste final)

No `server.py`, confirme que o domínio está na lista de origens permitidas:
```python
allow_origins=["https://1secondtask.com", "http://localhost:5500"],
```
Se necessário, adicione outros domínios e faça um novo `git push` para redeploy automático no Render.

---

## Fluxo de atualização de dados

1. Usuário acessa `https://1secondtask.com/raizes-financeiro`
2. Tela de senha aparece → usuário digita a senha
3. Dashboard carrega com os dados embutidos no HTML (sempre disponível, mesmo offline)
4. Usuário clica "↻ Atualizar dados" → o browser chama `POST /api/update` com a senha no header
5. O servidor baixa a planilha do Google Drive, roda o `extract.py`, devolve o JSON
6. O dashboard substitui os dados em memória e re-renderiza todas as abas
7. Header mostra "Atualizado: DD/MM/YYYY HH:MM"

> **Nota Render free tier:** o serviço "dorme" após 15 min de inatividade. A primeira chamada após inatividade pode levar ~30s para acordar. Para evitar isso, configure um cron job de ping (ex: https://cron-job.org) para chamar `GET https://raizes-dashboard-api.onrender.com/` a cada 10 min.

---

## Variáveis de ambiente resumidas

| Variável | Onde definir | Valor |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Render dashboard | Conteúdo do .json da service account |
| `GOOGLE_SHEETS_FILE_ID` | render.yaml | `1U7-LGnPc9JktExevHyZMTEY8kPcwzI3yf_1hjsRpaTM` |
| `DASHBOARD_PASSWORD` | Render dashboard | Senha escolhida |
