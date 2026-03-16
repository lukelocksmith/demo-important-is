---
name: demo-is
description: Wdrażaj i zarządzaj projektami HTML/CSS/JS na demo.important.is przez API. Użyj gdy chcesz wrzucić prototyp, zaktualizować plik, dodać hasło lub sprawdzić komentarze klienta.
argument-hint: [deploy|update|list|password|comments]
---

# demo.important.is — Skill dla Claude Code

Narzędzie do szybkiego wdrażania prototypów HTML/CSS/JS pod unikalny URL i dzielenia się z klientem.

## Podstawowe informacje

| Co | Wartość |
|---|---|
| URL | https://demo.important.is |
| Admin panel | https://demo.important.is/admin |
| Auth | Basic Auth: `admin` + hasło z ADMIN_PASSWORD env |
| Stack | Bun + Hono + Monaco Editor + Claude API |

## Dostęp z Claude Code (przez API, bez MCP)

Wszystkie operacje wykonuj przez `curl` w Bash tool. Podstawowy nagłówek auth:

```bash
AUTH="admin:$(source ~/.claude/keys.env && echo $DEMO_ADMIN_PASSWORD)"
# lub zakoduj ręcznie:
AUTH_HEADER="Authorization: Basic $(echo -n 'admin:HASŁO' | base64)"
```

---

## API — Wszystkie endpointy

### 1. Wdróż nowy projekt (HTML string)

```bash
curl -s -X POST https://demo.important.is/api/projects/paste \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "klient-abc",
    "html": "<!DOCTYPE html><html><body><h1>Hello!</h1></body></html>"
  }'
# Odpowiedź: {"slug":"klient-abc"}
# URL dla klienta: https://demo.important.is/klient-abc
```

**Zasady slug:** tylko małe litery, cyfry, myślniki (`[a-z0-9][a-z0-9-]{0,62}`)

### 2. Lista projektów

```bash
curl -s https://demo.important.is/api/projects -u "admin:HASŁO" | jq .
# Zwraca: [{slug, files:[], hasPassword, commentCount}, ...]
```

### 3. Pobierz pliki projektu (do edycji)

```bash
curl -s https://demo.important.is/api/projects/klient-abc -u "admin:HASŁO" | jq .
# Zwraca: {slug, files:[{name, content}, ...]}
```

### 4. Zaktualizuj plik w projekcie

```bash
curl -s -X PUT https://demo.important.is/api/projects/klient-abc \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "index.html",
    "content": "<!DOCTYPE html><html><body><h1>Poprawiona wersja</h1></body></html>"
  }'
```

### 5. Usuń projekt

```bash
curl -s -X DELETE https://demo.important.is/api/projects/klient-abc -u "admin:HASŁO"
```

---

## Ochrona hasłem (nowa funkcja)

Ustaw hasło — klient musi je wpisać, żeby zobaczyć stronę:

```bash
# Ustaw hasło
curl -s -X PATCH https://demo.important.is/api/projects/klient-abc/settings \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d '{"password": "tajnehaslo123"}'

# Usuń hasło (brak ochrony)
curl -s -X PATCH https://demo.important.is/api/projects/klient-abc/settings \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d '{"password": null}'
```

Klient wejdzie na `demo.important.is/klient-abc` → zobaczy formularz z polem hasła.

---

## Komentarze klienta (nowa funkcja)

Klient widzi na stronie przycisk 💬. Klikając w dowolne miejsce może zostawić komentarz z pozycją (X%/Y%).

### Pobierz komentarze projektu

```bash
curl -s https://demo.important.is/api/projects/klient-abc/comments \
  -u "admin:HASŁO" | jq .
# Zwraca: [{id, text, x, y, createdAt, resolved}, ...]
```

### Oznacz komentarz jako rozwiązany

```bash
curl -s -X PATCH https://demo.important.is/api/projects/klient-abc/comments/COMMENT_ID \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d '{"resolved": true}'
```

### Usuń komentarz

```bash
curl -s -X DELETE https://demo.important.is/api/projects/klient-abc/comments/COMMENT_ID \
  -u "admin:HASŁO"
```

---

## Typowy workflow Claude Code

```
1. Wygeneruj HTML (np. na prośbę klienta lub z własnej głowy)
2. Wdróż: POST /api/projects/paste z {slug, html}
3. Wyślij link klientowi: https://demo.important.is/slug
4. Opcjonalnie: ustaw hasło przez PATCH /api/projects/slug/settings
5. Klient zostawia komentarze przez 💬 na stronie
6. Sprawdź komentarze: GET /api/projects/slug/comments
7. Popraw HTML i wyślij zaktualizowaną wersję: PUT /api/projects/slug
```

## Przykład pełnego flow w Claude Code

```bash
# 1. Wdróż projekt
curl -s -X POST https://demo.important.is/api/projects/paste \
  -u "admin:HASŁO" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"slug":"klient-xyz","html":"<!DOCTYPE html><html lang='pl'><head><title>Oferta</title></head><body><h1>Witaj!</h1></body></html>"}
EOF

# 2. Ustaw hasło
curl -s -X PATCH https://demo.important.is/api/projects/klient-xyz/settings \
  -u "admin:HASŁO" -H "Content-Type: application/json" \
  -d '{"password":"klient2024"}'

# 3. Sprawdź komentarze po kilku godzinach
curl -s https://demo.important.is/api/projects/klient-xyz/comments \
  -u "admin:HASŁO" | jq '[.[] | select(.resolved == false)]'
```

---

## Diagnostyka

```bash
# Czy serwer działa?
curl -s -o /dev/null -w "%{http_code}" https://demo.important.is/admin
# Oczekiwane: 401 (Basic Auth challenge = serwer działa)

# Sprawdź kontener na serwerze
sshpass -p 'RsagfCD5GzjWzC' ssh -o StrictHostKeyChecking=no root@65.21.75.39 \
  "docker logs \$(docker ps | grep ockscs | awk '{print \$1}') --tail 20"
```

## Redeploy po zmianie kodu

```bash
cd ~/Projects/demo-app
git add . && git commit -m "fix: opis" && git push
curl -X GET "https://coolify.important.is/api/v1/deploy?uuid=ockscs0wws0gsokc0oooo084&force=false" \
  -H "Authorization: Bearer 6|hVwnfqjgEkCxAWdeYaSJ22OYpkff5jkO1Jcw55gEa6e81e1a"
```

## Dane techniczne

| Zmienna | Wartość |
|---|---|
| GitHub | https://github.com/lukelocksmith/demo-important-is |
| Kod lokalny | `~/Projects/demo-app/` |
| Dane na serwerze | `/data/demo-important-is/projects/` |
| Coolify UUID | `ockscs0wws0gsokc0oooo084` |
| Coolify API token | `6|hVwnfqjgEkCxAWdeYaSJ22OYpkff5jkO1Jcw55gEa6e81e1a` |
