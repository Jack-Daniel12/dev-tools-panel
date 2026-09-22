// config.js
//
// I valori qui sotto NON sono segreti: la configurazione web di Firebase
// è pensata per stare nel codice pubblico (lo dice la stessa
// documentazione ufficiale di Firebase) — la sicurezza vera è affidata
// alle regole di sicurezza (firestore.rules) e all'accesso con
// password, non a nascondere questi valori. Per questo, a differenza
// della versione precedente, questa pagina può stare tranquillamente in
// un repository GitHub PUBBLICO, senza bisogno di un piano a pagamento.
//
// 1. FIREBASE_CONFIG: la trovi nella console Firebase → icona ingranaggio
//    → Impostazioni progetto → in fondo alla scheda "Generali", sezione
//    "Le tue app" → clicca sull'icona web (</>) per registrare un'app
//    web (se non l'hai già fatto) → copia l'oggetto che ti mostra.
// 2. ADMIN_EMAIL: l'email che hai usato con strumenti/imposta-admin.js.

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2yEvQaoUaT4ac6ELJ9EWSjLd58y8ejBc",
  authDomain: "gestionale-magazzino-28de6.firebaseapp.com",
  projectId: "gestionale-magazzino-28de6",
  storageBucket: "gestionale-magazzino-28de6.firebasestorage.app",
  messagingSenderId: "795812738394",
  appId: "1:795812738394:web:9f2ff8419f2ef492f22f63"
};

var ADMIN_EMAIL = "rizzadanielvincenzo@gmail.com";
