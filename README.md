# KRISHINITI Database (PostgreSQL)
Create DB:  createdb krishiniti   (or use Neon/Supabase and copy the URL)

    psql "$DATABASE_URL" -f schema.sql
    psql "$DATABASE_URL" -f migrations/001_krishiniti_prototype.sql
    psql "$DATABASE_URL" -f migrations/002_crop_value_chain.sql

002 creates crop_value_chain (105 rows), and view crop_value_summary.
Demo buyers/farmers: run npm run db:setup and npm run seed:demo inside backend/.
Check: SELECT * FROM crop_value_summary LIMIT 5;
Value chain is a static reference, not live demand.


---
## Push this repo to GitHub
1. On github.com click **New repository**, name it `krishiniti-database`, leave it empty (no README), click Create.
2. In this folder run:
```bash
git init
git add .
git status        # make sure no .env file is listed
git commit -m "Initial commit: krishiniti-database"
git branch -M main
git remote add origin https://github.com/<your-username>/krishiniti-database.git
git push -u origin main
```
3. Later changes: `git add . && git commit -m "message" && git push`
4. Never commit .env files or API keys.
