# demo.important.is — Mini Netlify z AI Edytorem

Narzędzie do szybkiego pokazywania prototypów klientom.
Serwuje statyczne strony HTML/CSS/JS pod unikalnym URL + panel admina z Monaco Editor i Claude AI.

---

## Co robi

- `demo.important.is/admin` → panel admina (login: `admin` / hasło w env)
- `demo.important.is/[slug]` → publiczna strona dla klienta
- Tworzenie projektów: wklej HTML lub wgraj ZIP
- Edycja w przeglądarce: Monaco Editor (jak VS Code) + AI (Claude Haiku)
- `⌘S` zapisuje i odświeża preview na żywo

## Flow pracy

```
1. Wygeneruj HTML z AI (Claude, ChatGPT, v0, itp.)
2. Wejdź na demo.important.is/admin
3. Kliknij "+ Nowy projekt" → wklej HTML → wpisz slug → Utwórz
4. Wyślij link demo.important.is/slug klientowi
5. Klient chce poprawkę → wejdź do admina → edytuj
   - ręcznie w Monaco Editor, LUB
   - wpisz instrukcję w polu AI → Enter → AI poprawia automatycznie
6. ⌘S → preview się odświeża → link klienta też
```

---

## Stack

| Warstwa | Technologia |
|---|---|
| Runtime | Bun |
| Framework | Hono |
| Editor | Monaco Editor (CDN) |
| AI | Anthropic Claude (claude-haiku-4-5-20251001) |
| Storage | Filesystem `/data/projects/[slug]/` |
| Auth | HTTP Basic Auth na /admin i /api/* |
| Deploy | Coolify → Docker → Traefik |

---

## Deployment

### Gdzie działa
- **Serwer:** Hetzner 65.21.75.39
- **Coolify app UUID:** `ockscs0wws0gsokc0oooo084`
- **Container name:** `ockscs0wws0gsokc0oooo084-[hash]`
- **GitHub repo:** `https://github.com/lukelocksmith/demo-important-is`
- **Dane:** `/data/demo-important-is/projects/` na hoście (bind mount → `/data` w kontenerze)

### Jak zrobić redeploy po zmianie kodu
```bash
# 1. Wypchnij zmiany do GitHub
git add . && git commit -m "..." && git push

# 2. Wywołaj deploy przez Coolify API
curl -X GET "https://coolify.important.is/api/v1/deploy?uuid=ockscs0wws0gsokc0oooo084&force=false" \
  -H "Authorization: Bearer 6|hVwnfqjgEkCxAWdeYaSJ22OYpkff5jkO1Jcw55gEa6e81e1a"
```

### Env variables (ustawione w Coolify)
| Zmienna | Opis |
|---|---|
| `ADMIN_PASSWORD` | Hasło do /admin |
| `ANTHROPIC_API_KEY` | Klucz do Claude API |
| `PORT` | 3000 |
| `DATA_DIR` | /data/projects |

### Persistent storage
Dane projektów są zapisane w `/data/demo-important-is/` na hoście serwera.
Bind mount jest skonfigurowany w tabeli `local_persistent_volumes` w Coolify DB:

```sql
-- Weryfikacja:
docker exec coolify-db psql -U coolify -d coolify \
  -c "SELECT * FROM local_persistent_volumes WHERE resource_id = 10;"
```

Jeśli po redeploy mount zniknie:
```bash
# Na serwerze:
docker stop [container_name]
docker run ... -v /data/demo-important-is:/data ... [image]
# Lub przez Coolify UI: aplikacja → Persistent Storage → dodaj /data/demo-important-is → /data
```

---

## Struktura kodu

```
src/
├── index.ts       # Hono server — wszystkie routes, API, static serving
└── admin.html     # Admin panel UI (Monaco + AI + preview)
Dockerfile         # FROM oven/bun:1-alpine, port 3000
package.json       # hono, @anthropic-ai/sdk, jszip
```

### Routes
```
GET  /                        → redirect /admin
GET  /admin                   → panel (Basic Auth)
POST /api/projects/paste      → utwórz projekt z HTML string
POST /api/projects/upload     → utwórz projekt z ZIP
GET  /api/projects            → lista projektów
GET  /api/projects/:slug      → pliki projektu (do edytora)
PUT  /api/projects/:slug      → zapisz plik
DEL  /api/projects/:slug      → usuń projekt
POST /api/ai/edit             → Claude API → zwraca poprawiony kod
GET  /:slug                   → serwuje index.html projektu
GET  /:slug/:file             → serwuje statyczny plik projektu
```

### Walidacja bezpieczeństwa
- Slug: `/^[a-z0-9][a-z0-9-]{0,62}$/` — tylko bezpieczne znaki
- Filename: `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/` — bez `..`
- Path traversal protection: `safePath()` sprawdza czy ścieżka jest wewnątrz project dir
- DOM rendering: brak `innerHTML` z danymi użytkownika — używamy `createElement` + `textContent`

---

## Diagnostyka

```bash
# Sprawdź czy działa
curl -I https://demo.important.is/admin

# Sprawdź kontener
ssh root@65.21.75.39
docker ps | grep ockscs

# Logi
docker logs $(docker ps | grep ockscs | awk '{print $1}') --tail 50

# Sprawdź dane
ls /data/demo-important-is/projects/

# Test API
curl -u "admin:[HASŁO]" https://demo.important.is/api/projects
```

---

## Możliwe rozszerzenia (TODO)

- [ ] Własna strona logowania zamiast Basic Auth (brzydkie okienko przeglądarki)
- [ ] TTL dla projektów (auto-usuń po X dniach)
- [ ] Lista projektów na stronie głównej (publiczna lub chroniona)
- [ ] Upload wielu plików (nie tylko ZIP)
- [ ] Historia zmian (git per projekt)
- [ ] Własna domena dla projektu (CNAME)
- [ ] Podgląd na mobile (responsive preview toggle)
