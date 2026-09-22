// adminAziende.js
// Equivalente di functions/src/adminAziende.js, eseguito dentro al
// pannello. Il login non è più "manda un hash, ricevi un token": è un
// vero accesso Firebase (adminLogin in base.js, email+password). Da lì
// in poi le regole di sicurezza riconoscono l'utente admin dal suo
// permesso speciale (custom claim "admin", assegnato una tantum con
// strumenti/imposta-admin.js) e permettono queste operazioni.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { aziendaRef } from './licenze.js';
import { normalizzaCodice, timestampAIso } from './utils.js';

// ---------------- ELENCO / DETTAGLIO ----------------

export async function adminElencoAziende(db) {
  const snap = await getDocs(query(collection(db, 'aziende'), orderBy('cliente')));
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      codice: v.codice,
      cliente: v.cliente,
      stato: v.stato,
      scadenza: v.scadenza || '',
      motivo: v.motivo || '',
      sincronizzazioneAbilitata: v.sincronizzazioneAbilitata !== false,
      note: v.note || '',
      limiteDispositivi: v.limiteDispositivi ?? null,
      numeroDispositivi: v.numeroDispositivi || 0,
      creatoIl: timestampAIso(v.creatoIl),
      modificatoIl: timestampAIso(v.modificatoIl)
    };
  });
}

export async function adminElencoDispositivi(db, codice) {
  const snap = await getDocs(query(collection(db, 'aziende', normalizzaCodice(codice), 'dispositivi'), orderBy('primoUtilizzo')));
  return snap.docs.map((d) => {
    const v = d.data();
    return { idDispositivo: v.idDispositivo, primoUtilizzo: timestampAIso(v.primoUtilizzo), ultimoUtilizzo: timestampAIso(v.ultimoUtilizzo) };
  });
}

// ---------------- SALVA / ELIMINA AZIENDA ----------------

export async function adminSalvaAzienda(db, dati) {
  const codice = normalizzaCodice(dati.codice);
  if (!codice) return { successo: false, errore: 'Il codice è obbligatorio.' };
  if (!dati.cliente || !String(dati.cliente).trim()) return { successo: false, errore: 'Il nome azienda è obbligatorio.' };

  let limiteDispositivi = null;
  if (dati.limiteDispositivi !== undefined && dati.limiteDispositivi !== null && dati.limiteDispositivi !== '') {
    const n = parseInt(dati.limiteDispositivi, 10);
    if (!isNaN(n) && n > 0) limiteDispositivi = n;
  }
  const stato = dati.stato === 'sospeso' || dati.stato === 'revocato' ? dati.stato : 'attivo';
  const sincronizzazioneAbilitata = stato === 'revocato' ? false : dati.sincronizzazioneAbilitata !== false;

  const ref = aziendaRef(db, codice);
  const snap = await getDoc(ref);
  const campi = {
    codice,
    cliente: String(dati.cliente).trim(),
    stato,
    scadenza: dati.scadenza || '',
    motivo: dati.motivo || '',
    sincronizzazioneAbilitata,
    note: dati.note || '',
    limiteDispositivi,
    modificatoIl: serverTimestamp()
  };

  if (snap.exists()) {
    await updateDoc(ref, campi);
  } else {
    await setDoc(ref, { ...campi, numeroDispositivi: 0, creatoIl: serverTimestamp() });
  }
  return { successo: true };
}

export async function adminRimuoviDispositivo(db, codice, idDispositivo) {
  const codiceNorm = normalizzaCodice(codice);
  const ref = aziendaRef(db, codiceNorm);
  const dispositivoRef = doc(db, 'aziende', codiceNorm, 'dispositivi', idDispositivo);

  const dispSnap = await getDoc(dispositivoRef);
  if (!dispSnap.exists()) return { successo: true }; // già assente

  const aziendaSnap = await getDoc(ref);
  const numeroAttuale = (aziendaSnap.data() || {}).numeroDispositivi || 0;

  const batch = writeBatch(db);
  batch.delete(dispositivoRef);
  batch.update(ref, { numeroDispositivi: Math.max(0, numeroAttuale - 1), modificatoIl: serverTimestamp() });
  await batch.commit();
  return { successo: true };
}

// Cancella tutti i documenti di una sotto-collezione, a lotti da 500
// (limite di Firestore per singolo batch). Usata sia per "elimina dati"
// sia per "elimina azienda".
async function svuotaCollezione(db, collRef) {
  let continua = true;
  while (continua) {
    const snap = await getDocs(collRef);
    if (snap.empty) {
      continua = false;
      break;
    }
    const lotto = snap.docs.slice(0, 500);
    const batch = writeBatch(db);
    lotto.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.docs.length < 500) continua = false;
  }
}

// Come nella versione a Cloud Functions: cancella anche i dati (non solo
// la licenza), per evitare che un codice riusato in futuro erediti dati
// vecchi — vedi il commento nella versione precedente per il perché.
export async function adminEliminaAzienda(db, codice) {
  const codiceNorm = normalizzaCodice(codice);
  const ref = aziendaRef(db, codiceNorm);

  for (const nome of ['dispositivi', 'prodotti', 'movimenti', 'fatture', 'righeFattura', 'codaTelefono']) {
    await svuotaCollezione(db, collection(db, 'aziende', codiceNorm, nome));
  }
  await deleteDoc(ref);
  return { successo: true };
}

// Come nell'originale: elimina SOLO l'archivio dati, non la licenza né i
// dispositivi collegati.
export async function adminEliminaDatiAzienda(db, codice) {
  const codiceNorm = normalizzaCodice(codice);
  for (const nome of ['prodotti', 'movimenti', 'fatture', 'righeFattura', 'codaTelefono']) {
    await svuotaCollezione(db, collection(db, 'aziende', codiceNorm, nome));
  }
  await updateDoc(aziendaRef(db, codiceNorm), { ultimaSincronizzazione: deleteField() });
  return { successo: true };
}

export async function adminInfoArchivioAzienda(db, codice) {
  const codiceNorm = normalizzaCodice(codice);
  const ref = aziendaRef(db, codiceNorm);
  const [aziendaSnap, prodottiConteggio, movimentiConteggio, fattureConteggio] = await Promise.all([
    getDoc(ref),
    getCountFromServer(collection(db, 'aziende', codiceNorm, 'prodotti')),
    getCountFromServer(collection(db, 'aziende', codiceNorm, 'movimenti')),
    getCountFromServer(collection(db, 'aziende', codiceNorm, 'fatture'))
  ]);

  const azienda = aziendaSnap.data() || {};
  if (!azienda.ultimaSincronizzazione) return { esiste: false };

  return {
    esiste: true,
    ultimoAggiornamento: timestampAIso(azienda.ultimaSincronizzazione),
    numeroProdotti: prodottiConteggio.data().count,
    numeroMovimenti: movimentiConteggio.data().count,
    numeroFatture: fattureConteggio.data().count
  };
}
