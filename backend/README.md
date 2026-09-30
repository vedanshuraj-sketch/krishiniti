# krishiniti-backend

```bash
npm install
cp .env.example .env     # fill DATABASE_URL, JWT_SECRET (never commit .env)
npm run db:setup         # tables + demo buyers + value chain
npm run dev
npm test                 # 134 checks standalone
```
Health: /health , /health/dependencies . Value chain (public): /api/usage/crops


---
## Push this repo to GitHub
1. On github.com click **New repository**, name it `krishiniti-backend`, leave it empty (no README), click Create.
2. In this folder run:
```bash
git init
git add .
git status        # make sure no .env file is listed
git commit -m "Initial commit: krishiniti-backend"
git branch -M main
git remote add origin https://github.com/<your-username>/krishiniti-backend.git
git push -u origin main
```
3. Later changes: `git add . && git commit -m "message" && git push`
4. Never commit .env files or API keys.
