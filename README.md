# Pubblicare il pannello di amministrazione

## 1. Prima di pubblicare: configura Firebase

Segui prima tutto quello che c'è in `LEGGIMI.md` e in
`docs/00-stato-avanzamento.md` nella cartella principale del progetto:
progetto Firebase creato, regole pubblicate, account admin creato con
`strumenti/imposta-admin.js`.

## 2. Configura questa cartella

Apri `config.js` e incolla:
- `FIREBASE_CONFIG`: i dati del progetto (console Firebase →
  Impostazioni progetto → in fondo, "Le tue app" → icona web `</>` per
  registrarne una se non l'hai già fatto → copia l'oggetto mostrato)
- `ADMIN_EMAIL`: l'email che hai usato con `imposta-admin.js`

## 3. Crea il repository e pubblica

A differenza della versione precedente, **questa volta un repository
GitHub pubblico va benissimo**: i dati dentro `config.js` non sono
segreti (è la configurazione web di Firebase, pensata per essere
pubblica — la vera protezione sono le regole di sicurezza e la
password). Nessun bisogno di un piano GitHub a pagamento.

1. Crea un repository su GitHub, pubblico.
2. Carica tutti i file di questa cartella (`index.html`, `style.css`,
   `app.js`, `config.js`, `manifest.json`, `icon-192.png`,
   `icon-512.png`, e l'intera cartella `lib/`).
3. Attiva GitHub Pages (Settings → Pages → Deploy from a branch → main
   → / root → Save).

## 4. Aggiungi l'icona alla Home del telefono

Apri l'indirizzo pubblicato dal telefono (Chrome su Android): menu (⋮) →
**Aggiungi a schermata Home**.

## Come funziona ora la password

Non è più un hash calcolato a mano nel browser: è un vero accesso
Firebase (email + password), verificato dai server di Google con un
algoritmo pensato apposta per le password (più robusto del semplice
SHA-256 di prima). Dopo il primo accesso riuscito, Firebase ricorda la
sessione da solo (stesso comportamento del "Ricordami" di prima, qui
automatico) finché non premi **Esci**.

## Se cambi la password in futuro

Rilancia `node imposta-admin.js "stessa-email" "nuova-password"` dalla
cartella `strumenti` — aggiorna la password sullo stesso account invece
di crearne uno nuovo.

## Sulla cartella `lib/`

Contiene una copia dei file di `client-condiviso/` nella cartella
principale del progetto — copiata qui perché questa pagina vive nel suo
repository a sé (come nella versione precedente). Se in futuro cambi la
logica in `client-condiviso/`, ricordati di copiare di nuovo i file
aggiornati anche qui.
