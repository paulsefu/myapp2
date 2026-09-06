# Obiective financiare — GitHub Pages + Supabase

Aceasta este copia aplicației „Obiective financiare”, adaptată să ruleze ca site static pe GitHub Pages și să folosească Supabase pentru conturi și sincronizare.

Designul, seiful criptat, cheia de recuperare, tabelul, calculele, obiectivele, categoriile, importul JSON și plățile recurente au fost păstrate din aplicația originală.

## Nou în versiunea 1.3

- secțiunea mare „Evidența lunară” a fost eliminată din ecranul principal;
- fiecare obiectiv afișează direct suma „De pus acum” și statusul său;
- butonul „Am pus” înregistrează rapid suma integrală sau o sumă parțială;
- butonul „Istoric” deschide lunile acelui obiectiv numai când sunt necesare;
- butonul „Am pus toate sumele” confirmă dintr-o dată toate depunerile curente;
- restanțele sunt calculate separat pentru fiecare obiectiv, fără ca o plată în plus să ascundă restanța altuia;
- confirmarea unei reînnoiri marchează ciclul ajuns la scadență ca plătit.

## Nou în versiunea 1.2

- toate obiectivele au câmpul „Am început să pun bani din data”, inclusiv cele nerecurente;
- istoricul vechi poate fi recalculat corect după completarea datei reale de început;
- obiectivele ajunse la 0 zile afișează butonul „Reînnoiește”;
- reînnoirea permite alegerea începutului noii valabilități, a perioadei în ani, a noii valori și a datei de la care începe economisirea;
- ciclul încheiat rămâne în istoricul lunar, iar următorul ciclu este urmărit separat.

## Nou în versiunea 1.1

- secțiune „Evidența lunară” pentru toate lunile de la începerea obiectivelor;
- suma planificată și suma pusă efectiv pentru fiecare obiectiv și lună;
- restanțele lunilor anterioare sunt adăugate automat la totalul de pus acum;
- buton „Am pus integral” pentru completarea rapidă a unei sume;
- data de început este disponibilă și pentru plățile recurente lunare;
- datele vechi sunt actualizate automat la noua structură, fără alt script SQL.

## Ce rămâne privat

- Fiecare utilizator are propriul cont Supabase.
- Row Level Security permite accesul numai la rândul utilizatorului autentificat.
- Obiectivele sunt criptate în browser cu AES-256-GCM înainte de a ajunge în Supabase.
- Parola seifului și cheia de recuperare nu sunt trimise în baza de date.

## 1. Pregătirea Supabase

1. Deschide proiectul Supabase.
2. Intră la **SQL Editor**.
3. Creează o interogare nouă, copiază tot conținutul din `supabase.sql` și apasă **Run**.
4. Intră la **Project Settings → API**.
5. Copiază:
   - **Project URL**;
   - cheia publică **anon** / **publishable**.
6. Deschide `public/config.js` și înlocuiește cele două texte `PASTE_...`.

Nu introduce niciodată cheia `service_role` în aplicație sau în GitHub.

## 2. Setarea adreselor de autentificare

În Supabase intră la **Authentication → URL Configuration**.

- La **Site URL** pune adresa GitHub Pages, de exemplu:
  `https://NUME.github.io/NUME-REPOSITORY/`
- La **Redirect URLs** adaugă exact aceeași adresă.

Această setare face ca linkul de confirmare primit prin email să revină pe aplicația publicată și nu pe `localhost`.

## 3. Publicarea pe GitHub Pages

1. Creează un repository gol pe GitHub.
2. Încarcă toate fișierele și directoarele proiectului, inclusiv `.github`.
3. Verifică să existe ramura `main`.
4. Intră în repository la **Settings → Pages**.
5. La **Build and deployment → Source**, selectează **GitHub Actions**.
6. Intră la fila **Actions** și așteaptă finalizarea fluxului „Publică pe GitHub Pages”.

La fiecare modificare împinsă în `main`, site-ul este reconstruit și publicat automat.

## Rulare locală

```bash
npm install
npm run dev
```

Build de verificare:

```bash
npm run build
```

## Fișiere importante

- `public/config.js` — conexiunea publică la Supabase;
- `supabase.sql` — tabelul și regulile de securitate;
- `.github/workflows/deploy-pages.yml` — publicarea automată;
- `src/components/ObjectiveVaultApp.tsx` — aplicația propriu-zisă;
- `src/lib/vault-crypto.ts` — criptarea locală a seifului.
