import { initFirebase, adminLogin, adminLogout, attendiSessioneRipristinata } from './lib/base.js';
import {
  adminElencoAziende,
  adminElencoDispositivi,
  adminSalvaAzienda,
  adminRimuoviDispositivo,
  adminEliminaAzienda,
  adminEliminaDatiAzienda,
  adminInfoArchivioAzienda
} from './lib/adminAziende.js';

(function () {
  var firebase = initFirebase(FIREBASE_CONFIG);
  var db = firebase.db;
  var auth = firebase.auth;

  function esc(t) { var d = document.createElement('div'); d.textContent = (t == null ? '' : t); return d.innerHTML; }
  function mostraToast(testo) {
    var t = document.getElementById('toast');
    t.textContent = testo;
    t.classList.add('visibile');
    setTimeout(function () { t.classList.remove('visibile'); }, 2400);
  }
  function formattaData(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formattaOraRelativa(iso) {
    if (!iso) return 'Mai sincronizzata';
    var diffMs = Date.now() - new Date(iso).getTime();
    var ore = Math.round(diffMs / 3600000);
    if (ore < 1) return 'Meno di un\'ora fa';
    if (ore < 24) return ore + (ore === 1 ? ' ora fa' : ' ore fa');
    var giorni = Math.round(ore / 24);
    return giorni + (giorni === 1 ? ' giorno fa' : ' giorni fa');
  }
  function giorniAllaScadenza(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  }
  function generaCodice() {
    var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    function blocco() { var s = ''; for (var i = 0; i < 4; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)]; return s; }
    return 'MC-' + blocco() + '-' + blocco();
  }

  // ---------------- FEEDBACK VISIVO "IN CORSO" ----------------
  function impostaCaricamento(bottone, testoInCorso) {
    if (!bottone.dataset.testoOriginale) bottone.dataset.testoOriginale = bottone.textContent;
    bottone.textContent = testoInCorso;
    bottone.disabled = true;
    bottone.classList.add('in-corso');
  }
  function rimuoviCaricamento(bottone) {
    if (bottone.dataset.testoOriginale) bottone.textContent = bottone.dataset.testoOriginale;
    bottone.disabled = false;
    bottone.classList.remove('in-corso');
  }
  function mostraOverlayCaricamento(testo) {
    document.getElementById('overlayCaricamentoTesto').textContent = testo || 'Attendere...';
    document.getElementById('overlayCaricamento').classList.remove('hidden');
  }
  function nascondiOverlayCaricamento() {
    document.getElementById('overlayCaricamento').classList.add('hidden');
  }

  // Traduce gli errori più comuni di Firebase Auth in un messaggio
  // comprensibile. A differenza della versione precedente, qui non
  // c'è più un hash calcolato a mano: Firebase gestisce da sé la
  // verifica della password (in modo più robusto: usa scrypt lato
  // server, non un semplice SHA-256).
  function messaggioErroreLogin(err) {
    var codice = err && err.code;
    if (codice === 'auth/invalid-credential' || codice === 'auth/wrong-password' || codice === 'auth/user-not-found') {
      return 'Password errata.';
    }
    if (codice === 'auth/too-many-requests') return 'Troppi tentativi: riprova tra qualche minuto.';
    if (codice === 'auth/network-request-failed') return 'Impossibile contattare il server. Controlla la connessione.';
    return 'Impossibile accedere' + (err && err.message ? ': ' + err.message : '.');
  }

  async function haPermessoAdmin(utente) {
    if (!utente) return false;
    var esito = await utente.getIdTokenResult();
    if (esito.claims.admin === true) return true;
    // Fallback raro: il permesso è stato assegnato dopo l'ultimo login,
    // forziamo un aggiornamento del token e ricontrolliamo una volta.
    var esitoFresco = await utente.getIdTokenResult(true);
    return esitoFresco.claims.admin === true;
  }

  var aziende = [];
  var filtroCorrente = 'tutte';
  var testoRicerca = '';
  var codiceAziendaAperta = null;
  var modalitaDettaglio = 'modifica';

  // ---------------- LOGIN / SESSIONE ----------------

  function mostraVista(nome) {
    document.getElementById('vistaLogin').style.display = nome === 'login' ? 'flex' : 'none';
    document.getElementById('vistaLista').style.display = nome === 'lista' ? 'flex' : 'none';
  }

  async function provaLogin() {
    var valore = document.getElementById('inputPassword').value;
    var errore = document.getElementById('loginErrore');
    errore.textContent = '';
    if (!valore.trim()) { errore.textContent = 'Scrivi la password.'; return; }

    var btn = document.getElementById('btnAccedi');
    btn.disabled = true;
    btn.textContent = 'Verifica...';
    mostraOverlayCaricamento('Verifica password...');

    try {
      var utente = await adminLogin(auth, ADMIN_EMAIL, valore);
      if (!(await haPermessoAdmin(utente))) {
        errore.textContent = 'Questo account non ha i permessi di amministratore.';
        await adminLogout(auth);
        return;
      }
      document.getElementById('inputPassword').value = '';
      entraNelPannello();
    } catch (e) {
      errore.textContent = messaggioErroreLogin(e);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Accedi';
      nascondiOverlayCaricamento();
    }
  }

  document.getElementById('btnAccedi').addEventListener('click', provaLogin);
  document.getElementById('inputPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') provaLogin(); });

  document.getElementById('btnEsci').addEventListener('click', async function () {
    await adminLogout(auth);
    mostraVista('login');
  });

  document.getElementById('btnRicaricaElenco').addEventListener('click', function () {
    caricaElenco();
    mostraToast('Elenco aggiornato.');
  });

  function entraNelPannello() {
    mostraVista('lista');
    caricaElenco();
    history.replaceState({ vista: 'lista' }, '', location.pathname);
  }

  // Firebase ricorda da solo la sessione tra un'apertura e l'altra
  // (stesso comportamento del "Ricordami" di prima, qui automatico):
  // aspettiamo che la ripristini, poi controlliamo che l'account abbia
  // ancora il permesso admin (potrebbe essere stato tolto nel frattempo).
  async function avvio() {
    mostraVista('login');
    try {
      var utente = await attendiSessioneRipristinata(auth);
      if (utente && (await haPermessoAdmin(utente))) {
        entraNelPannello();
      }
    } catch (e) {
      // problema di rete: mostriamo comunque il login, l'utente può riprovare
    }
  }

  // ---------------- LISTA ----------------

  document.getElementById('ricercaAziende').addEventListener('input', function (e) {
    testoRicerca = e.target.value.toLowerCase();
    renderLista();
  });

  document.querySelectorAll('.filtro-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filtro-chip').forEach(function (c) { c.classList.remove('attivo-filtro'); });
      chip.classList.add('attivo-filtro');
      filtroCorrente = chip.dataset.filtro;
      renderLista();
    });
  });

  async function caricaElenco() {
    document.getElementById('listaAziendeBody').innerHTML = '<div class="lista-vuota-admin">Caricamento...</div>';
    try {
      aziende = await adminElencoAziende(db);
      renderLista();
    } catch (e) {
      if (e && e.code === 'permission-denied') {
        mostraToast('Sessione scaduta, effettua di nuovo l\'accesso.');
        await adminLogout(auth);
        mostraVista('login');
        return;
      }
      document.getElementById('listaAziendeBody').innerHTML = '<div class="lista-vuota-admin">Impossibile contattare il server. Controlla la connessione e riprova.</div>';
    }
  }

  function aziendeFiltrate() {
    return aziende.filter(function (a) {
      if (testoRicerca && a.cliente.toLowerCase().indexOf(testoRicerca) === -1 && a.codice.toLowerCase().indexOf(testoRicerca) === -1) return false;
      if (filtroCorrente === 'tutte') return true;
      if (filtroCorrente === 'scadenza') { var g = giorniAllaScadenza(a.scadenza); return g !== null && g <= 30 && g >= 0; }
      return a.stato === filtroCorrente;
    });
  }

  function renderLista() {
    var elenco = aziendeFiltrate();
    var attive = aziende.filter(function (a) { return a.stato === 'attivo'; }).length;
    document.getElementById('conteggioAziende').textContent = aziende.length + ' aziend' + (aziende.length === 1 ? 'a' : 'e') + ' · ' + attive + ' attiv' + (attive === 1 ? 'a' : 'e');

    var corpo = document.getElementById('listaAziendeBody');
    if (elenco.length === 0) {
      corpo.innerHTML = '<div class="lista-vuota-admin">' + (aziende.length === 0 ? 'Nessuna azienda ancora. Creane una con il pulsante +.' : 'Nessuna azienda trovata con questi filtri.') + '</div>';
      return;
    }

    corpo.innerHTML = elenco.map(function (a) {
      var giorni = giorniAllaScadenza(a.scadenza);
      var classeScadenza = (giorni !== null && giorni <= 30 && giorni >= 0) ? 'in-scadenza' : '';
      var testoScadenza = a.scadenza ? ('Scade ' + formattaData(a.scadenza)) : 'Nessuna scadenza';
      return '' +
        '<div class="riga-azienda" data-id="' + esc(a.codice) + '">' +
          '<div class="stato-barra st-' + a.stato + '"></div>' +
          '<div class="contenuto-riga" data-apri="' + esc(a.codice) + '">' +
            '<div class="nome-cliente">' + esc(a.cliente) + '</div>' +
            '<div class="codice-cliente">' + esc(a.codice) + '</div>' +
            '<div class="riga-meta">' +
              '<span class="badge-stato st-' + a.stato + '">' + a.stato.charAt(0).toUpperCase() + a.stato.slice(1) + '</span>' +
              '<span class="scadenza-riga ' + classeScadenza + '">' + testoScadenza + '</span>' +
            '</div>' +
          '</div>' +
          '<label class="interruttore" title="Attiva/Revoca subito">' +
            '<input type="checkbox" class="switch-rapido" data-codice="' + esc(a.codice) + '" ' + (a.stato === 'attivo' ? 'checked' : '') + '>' +
            '<span class="interruttore-corsa"></span>' +
          '</label>' +
        '</div>';
    }).join('');

    corpo.querySelectorAll('[data-apri]').forEach(function (el) {
      el.addEventListener('click', function () { apriDettaglio(el.dataset.apri); });
    });
    corpo.querySelectorAll('.switch-rapido').forEach(function (sw) {
      sw.addEventListener('click', function (e) { e.stopPropagation(); });
      sw.addEventListener('change', async function () {
        var azienda = aziende.find(function (a) { return a.codice === sw.dataset.codice; });
        var nuovoStato = sw.checked ? 'attivo' : 'revocato';
        sw.disabled = true;
        sw.closest('.interruttore').classList.add('in-corso');
        mostraOverlayCaricamento(nuovoStato === 'attivo' ? 'Riattivazione in corso...' : 'Revoca in corso...');
        try {
          var payload = Object.assign({}, azienda, { stato: nuovoStato });
          if (nuovoStato === 'attivo') {
            payload.motivo = '';
            payload.sincronizzazioneAbilitata = true;
          }
          var d = await adminSalvaAzienda(db, payload);
          if (!d.successo) { mostraToast(d.errore || 'Errore.'); sw.checked = !sw.checked; return; }
          aziende = await adminElencoAziende(db);
          mostraToast(sw.checked ? 'Azienda riattivata.' : 'Azienda revocata: il PC del cliente si bloccherà al prossimo controllo.');
          renderLista();
        } catch (e) {
          mostraToast('Impossibile contattare il server.');
          sw.checked = !sw.checked;
        } finally {
          sw.disabled = false;
          sw.closest('.interruttore').classList.remove('in-corso');
          nascondiOverlayCaricamento();
        }
      });
    });
  }

  // ---------------- NUOVA AZIENDA ----------------
  document.getElementById('btnNuovaAzienda').addEventListener('click', function () {
    modalitaDettaglio = 'nuova';
    codiceAziendaAperta = null;
    apriVistaDettaglio({ codice: generaCodice(), cliente: '', stato: 'attivo', scadenza: '', motivo: '', numeroDispositivi: 0, limiteDispositivi: null, note: '', sincronizzazioneAbilitata: true }, 'Nuova azienda', 'Compila i dati e crea la licenza');
  });

  // ---------------- DETTAGLIO / MODIFICA ----------------
  function apriDettaglio(codice) {
    modalitaDettaglio = 'modifica';
    codiceAziendaAperta = codice;
    var a = aziende.find(function (x) { return x.codice === codice; });
    apriVistaDettaglio(a, a.cliente, 'Codice ' + a.codice);
    caricaInfoArchivio(codice);
    caricaListaDispositivi(codice);
  }

  function apriVistaDettaglio(a, titolo, sottotitolo) {
    document.getElementById('dettaglioTitolo').textContent = titolo || 'Azienda';
    document.getElementById('dettaglioSottotitolo').textContent = sottotitolo || '';
    document.getElementById('dettaglioCorpo').innerHTML = costruisciCorpoDettaglio(a);
    collegaEventiDettaglio(a);
    document.getElementById('vistaDettaglio').classList.add('aperta');
    history.pushState({ vista: 'dettaglio' }, '', location.pathname);
  }

  document.getElementById('btnIndietroDettaglio').addEventListener('click', function () {
    history.back();
  });
  function chiudiDettaglio() {
    document.getElementById('vistaDettaglio').classList.remove('aperta');
  }

  async function caricaInfoArchivio(codice) {
    var el = document.getElementById('infoSincronizzazione');
    if (!el) return;
    try {
      var d = await adminInfoArchivioAzienda(db, codice);
      if (!d.esiste) { el.textContent = 'Nessun dato ancora sincronizzato.'; return; }
      el.textContent = formattaOraRelativa(d.ultimoAggiornamento) + ' — ' + d.numeroProdotti + ' prodotti, ' + d.numeroMovimenti + ' movimenti registrati';
    } catch (e) {
      el.textContent = 'Non disponibile (problema di connessione).';
    }
  }

  // Il conteggio dei dispositivi è già disponibile subito (a.numeroDispositivi,
  // arrivato insieme all'elenco aziende); l'elenco puntuale con gli id, che
  // serve solo qui nel dettaglio, si carica a parte per non appesantire
  // l'elenco generale — vedi docs/00-stato-avanzamento.md.
  async function caricaListaDispositivi(codice) {
    var el = document.getElementById('listaDispositivi');
    if (!el) return;
    try {
      var dispositivi = await adminElencoDispositivi(db, codice);
      el.innerHTML = costruisciListaDispositivi(dispositivi);
      collegaEventiRimuoviDispositivo(codice);
    } catch (e) {
      el.innerHTML = '<div class="nota-dispositivo"><span class="valore assente">Non disponibile (problema di connessione)</span></div>';
    }
  }

  function costruisciListaDispositivi(dispositivi) {
    if (!dispositivi || dispositivi.length === 0) {
      return '<div class="nota-dispositivo"><span class="valore assente">Nessun dispositivo collegato ancora</span></div>';
    }
    return dispositivi.map(function (d) {
      return '<div class="nota-dispositivo" style="margin-bottom:6px">' +
        '<span class="valore">' + esc(d.idDispositivo) + (d.ultimoUtilizzo ? ' <small style="opacity:.6">— ultimo uso ' + formattaOraRelativa(d.ultimoUtilizzo) + '</small>' : '') + '</span>' +
        '<button class="btn-piccolo" data-rimuovi-dispositivo="' + esc(d.idDispositivo) + '">Rimuovi</button>' +
        '</div>';
    }).join('');
  }

  function collegaEventiRimuoviDispositivo(codice) {
    document.querySelectorAll('[data-rimuovi-dispositivo]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        impostaCaricamento(btn, '...');
        mostraOverlayCaricamento('Rimozione dispositivo...');
        try {
          var d = await adminRimuoviDispositivo(db, codice, btn.dataset.rimuoviDispositivo);
          if (!d.successo) { mostraToast(d.errore || 'Errore.'); return; }
          aziende = await adminElencoAziende(db);
          mostraToast('Dispositivo rimosso: il cliente potrà registrarne uno nuovo.');
          apriDettaglio(codice);
        } catch (e) {
          mostraToast('Impossibile contattare il server.');
        } finally {
          nascondiOverlayCaricamento();
        }
      });
    });
  }

  function costruisciCorpoDettaglio(a) {
    var mostraCampiExtra = modalitaDettaglio === 'modifica';
    return '' +
      '<div class="campo-gruppo"><label>Nome azienda</label><input type="text" id="campoCliente" value="' + esc(a.cliente) + '" placeholder="es. Trattoria da Mario"></div>' +
      '<div class="campo-gruppo"><label>Codice licenza</label>' +
        '<div class="riga-codice"><input type="text" id="campoCodice" value="' + esc(a.codice) + '" ' + (mostraCampiExtra ? 'readonly' : '') + '><button class="btn-copia" id="btnCopiaCodice">Copia</button></div>' +
      '</div>' +
      '<div class="campo-gruppo"><label>Stato</label>' +
        '<div class="segmentato" id="segmentatoStato">' +
          '<button data-stato="attivo" class="' + (a.stato === 'attivo' ? 'selezionato st-attivo' : '') + '">Attivo</button>' +
          '<button data-stato="sospeso" class="' + (a.stato === 'sospeso' ? 'selezionato st-sospeso' : '') + '">Sospeso</button>' +
          '<button data-stato="revocato" class="' + (a.stato === 'revocato' ? 'selezionato st-revocato' : '') + '">Revocato</button>' +
        '</div>' +
      '</div>' +
      '<div class="campo-gruppo" id="gruppoMotivo" style="' + (a.stato === 'attivo' ? 'display:none' : '') + '">' +
        '<label>Motivo (visibile al programma del cliente)</label>' +
        '<input type="text" id="campoMotivo" value="' + esc(a.motivo) + '" placeholder="es. Mancato pagamento">' +
      '</div>' +
      '<div class="campo-gruppo"><label>Scadenza (facoltativa)</label><input type="date" id="campoScadenza" value="' + esc(a.scadenza) + '"></div>' +
      '<div class="campo-gruppo">' +
        '<label>Limite dispositivi</label>' +
        '<div class="segmentato" id="segmentatoLimite">' +
          '<button data-limite="illimitato" class="' + (!a.limiteDispositivi ? 'selezionato st-attivo' : '') + '">Illimitato</button>' +
          '<button data-limite="definito" class="' + (a.limiteDispositivi ? 'selezionato st-attivo' : '') + '">Definito</button>' +
        '</div>' +
        '<input type="number" id="campoLimiteNumero" min="1" step="1" placeholder="es. 3" value="' + (a.limiteDispositivi || '') + '" style="margin-top:8px;' + (a.limiteDispositivi ? '' : 'display:none') + '">' +
        '<div class="spiega-campo">Quanti dispositivi diversi possono attivarsi con questo stesso codice. Chi è già collegato continua a funzionare anche se abbassi il limite sotto al numero attuale — semplicemente non se ne potranno aggiungere di nuovi finché non liberi posto.</div>' +
      '</div>' +
      (mostraCampiExtra ? (
        '<div class="campo-gruppo">' +
          '<label>Sincronizzazione dati</label>' +
          '<div class="nota-dispositivo">' +
            '<span class="valore" id="testoSincronizzazione">' + (a.stato === 'revocato' ? 'Disattivata (azienda revocata)' : (a.sincronizzazioneAbilitata !== false ? 'Attiva' : 'Disattivata manualmente')) + '</span>' +
            '<label class="interruttore" id="wrapInterruttoreSync"><input type="checkbox" id="toggleSincronizzazione" ' + (a.stato !== 'revocato' && a.sincronizzazioneAbilitata !== false ? 'checked' : '') + ' ' + (a.stato === 'revocato' ? 'disabled' : '') + '><span class="interruttore-corsa"></span></label>' +
          '</div>' +
          '<div class="spiega-campo">Se la disattivi, il programma del cliente nasconde subito anche i dati già scaricati sul suo PC, pure offline — non solo blocca nuovi invii. Con azienda revocata è sempre disattivata, non modificabile da qui.</div>' +
        '</div>'
      ) : '') +
      (mostraCampiExtra ? (
        '<div class="campo-gruppo"><label>Dispositivi collegati (' + (a.numeroDispositivi || 0) + ')</label>' +
          '<div id="listaDispositivi"><div class="nota-dispositivo">Caricamento...</div></div>' +
        '</div>' +
        '<div class="campo-gruppo"><label>Sincronizzazione condivisa</label><div class="info-sync" id="infoSincronizzazione">Caricamento...</div></div>'
      ) : '') +
      '<div class="campo-gruppo"><label>Note interne (solo per te)</label><textarea id="campoNote" placeholder="Annotazioni private su questo cliente...">' + esc(a.note) + '</textarea></div>' +
      '<button class="btn-salva" id="btnSalvaAzienda">' + (modalitaDettaglio === 'nuova' ? 'Crea azienda' : 'Salva modifiche') + '</button>' +
      (mostraCampiExtra ? (
        '<div class="zona-pericolo">' +
          '<label>Zona pericolosa</label>' +
          '<button class="btn-pericolo" id="btnEliminaDati">Elimina dati archiviati</button>' +
          '<div class="conferma-pericolo" id="confermaDati">' +
            '<p>Cancella per sempre l\'archivio di questa azienda (prodotti, giacenze, fatture). Al prossimo avvio, il PC del cliente si svuoterà. Non è recuperabile.</p>' +
            '<div class="riga-bottoni"><button class="btn-annulla-pericolo" data-annulla="confermaDati">Annulla</button><button class="btn-conferma-pericolo" data-conferma="dati">Elimina definitivamente</button></div>' +
          '</div>' +
          '<button class="btn-pericolo" id="btnEliminaAzienda">Elimina azienda</button>' +
          '<div class="conferma-pericolo" id="confermaAzienda">' +
            '<p>Rimuove anche il codice licenza e tutti i dati collegati: il cliente non potrà più accedere con questo codice. Usalo solo se l\'azienda non è più tua cliente.</p>' +
            '<div class="riga-bottoni"><button class="btn-annulla-pericolo" data-annulla="confermaAzienda">Annulla</button><button class="btn-conferma-pericolo" data-conferma="azienda">Elimina definitivamente</button></div>' +
          '</div>' +
        '</div>'
      ) : '');
  }

  function collegaEventiDettaglio(a) {
    document.getElementById('btnCopiaCodice').addEventListener('click', function () {
      var campo = document.getElementById('campoCodice');
      campo.select();
      try { document.execCommand('copy'); } catch (e) {}
      if (navigator.clipboard) navigator.clipboard.writeText(campo.value).catch(function () {});
      mostraToast('Codice copiato.');
    });

    document.querySelectorAll('#segmentatoStato button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#segmentatoStato button').forEach(function (b) { b.className = ''; });
        btn.className = 'selezionato st-' + btn.dataset.stato;
        document.getElementById('gruppoMotivo').style.display = btn.dataset.stato === 'attivo' ? 'none' : 'block';

        var toggleSync = document.getElementById('toggleSincronizzazione');
        var testoSync = document.getElementById('testoSincronizzazione');
        if (toggleSync) {
          if (btn.dataset.stato === 'revocato') {
            toggleSync.checked = false;
            toggleSync.disabled = true;
            testoSync.textContent = 'Disattivata (azienda revocata)';
          } else {
            toggleSync.disabled = false;
            var eraRevocato = a.stato === 'revocato';
            toggleSync.checked = eraRevocato ? true : (a.sincronizzazioneAbilitata !== false);
            testoSync.textContent = toggleSync.checked ? 'Attiva' : 'Disattivata manualmente';
          }
        }
      });
    });

    var toggleSyncEl = document.getElementById('toggleSincronizzazione');
    if (toggleSyncEl) toggleSyncEl.addEventListener('change', function () {
      document.getElementById('testoSincronizzazione').textContent = toggleSyncEl.checked ? 'Attiva' : 'Disattivata manualmente';
    });

    document.querySelectorAll('#segmentatoLimite button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#segmentatoLimite button').forEach(function (b) { b.className = ''; });
        btn.className = 'selezionato st-attivo';
        var campoNumero = document.getElementById('campoLimiteNumero');
        if (btn.dataset.limite === 'definito') {
          campoNumero.style.display = '';
          if (!campoNumero.value) campoNumero.value = 1;
          campoNumero.focus();
        } else {
          campoNumero.style.display = 'none';
        }
      });
    });

    document.getElementById('btnSalvaAzienda').addEventListener('click', async function () {
      var statoSelezionato = document.querySelector('#segmentatoStato button.selezionato');
      var cliente = document.getElementById('campoCliente').value.trim();
      var codice = document.getElementById('campoCodice').value.trim();
      if (!cliente) { mostraToast('Scrivi il nome dell\'azienda.'); return; }
      if (!codice) { mostraToast('Il codice licenza non può essere vuoto.'); return; }

      var datiAggiornati = {
        cliente: cliente,
        codice: codice,
        stato: statoSelezionato ? statoSelezionato.dataset.stato : 'attivo',
        motivo: document.getElementById('campoMotivo') ? document.getElementById('campoMotivo').value.trim() : '',
        scadenza: document.getElementById('campoScadenza').value,
        note: document.getElementById('campoNote').value.trim()
      };
      var toggleSyncSalva = document.getElementById('toggleSincronizzazione');
      if (toggleSyncSalva) datiAggiornati.sincronizzazioneAbilitata = toggleSyncSalva.checked;
      var limiteSelezionato = document.querySelector('#segmentatoLimite button.selezionato');
      if (limiteSelezionato && limiteSelezionato.dataset.limite === 'definito') {
        datiAggiornati.limiteDispositivi = document.getElementById('campoLimiteNumero').value || 1;
      } else {
        datiAggiornati.limiteDispositivi = null;
      }

      var btnSalva = document.getElementById('btnSalvaAzienda');
      impostaCaricamento(btnSalva, modalitaDettaglio === 'nuova' ? 'Creazione...' : 'Salvataggio...');
      mostraOverlayCaricamento(modalitaDettaglio === 'nuova' ? 'Creazione azienda...' : 'Salvataggio in corso...');
      try {
        var d = await adminSalvaAzienda(db, datiAggiornati);
        if (!d.successo) { mostraToast(d.errore || 'Errore nel salvataggio.'); return; }
        aziende = await adminElencoAziende(db);
        mostraToast(modalitaDettaglio === 'nuova' ? 'Azienda creata.' : 'Modifiche salvate.');
        chiudiDettaglio();
        renderLista();
      } catch (e) {
        mostraToast('Impossibile contattare il server. Le modifiche non sono state salvate.');
      } finally {
        rimuoviCaricamento(btnSalva);
        nascondiOverlayCaricamento();
      }
    });

    document.querySelectorAll('[data-conferma]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        impostaCaricamento(btn, 'Eliminazione...');
        mostraOverlayCaricamento('Eliminazione in corso...');
        try {
          if (btn.dataset.conferma === 'dati') {
            var d1 = await adminEliminaDatiAzienda(db, a.codice);
            if (!d1.successo) { mostraToast(d1.errore || 'Errore.'); return; }
            mostraToast('Dati archiviati eliminati.');
            document.getElementById('confermaDati').classList.remove('visibile');
            caricaInfoArchivio(a.codice);
          } else if (btn.dataset.conferma === 'azienda') {
            var d2 = await adminEliminaAzienda(db, a.codice);
            if (!d2.successo) { mostraToast(d2.errore || 'Errore.'); return; }
            aziende = await adminElencoAziende(db);
            mostraToast('Azienda eliminata.');
            chiudiDettaglio();
            renderLista();
          }
        } catch (e) {
          mostraToast('Impossibile contattare il server.');
        } finally {
          rimuoviCaricamento(btn);
          nascondiOverlayCaricamento();
        }
      });
    });
    document.querySelectorAll('[data-annulla]').forEach(function (btn) {
      btn.addEventListener('click', function () { document.getElementById(btn.dataset.annulla).classList.remove('visibile'); });
    });

    var btnMostraConfermaDati = document.getElementById('btnEliminaDati');
    if (btnMostraConfermaDati) btnMostraConfermaDati.addEventListener('click', function () { document.getElementById('confermaDati').classList.add('visibile'); });
    var btnMostraConfermaAzienda = document.getElementById('btnEliminaAzienda');
    if (btnMostraConfermaAzienda) btnMostraConfermaAzienda.addEventListener('click', function () { document.getElementById('confermaAzienda').classList.add('visibile'); });
  }

  // ---------------- GESTIONE TASTO/GESTO "INDIETRO" DEL TELEFONO ----------------
  var tentativiUscita = 0;
  var timerResetUscita = null;

  window.addEventListener('popstate', function (e) {
    var dettaglioAperto = document.getElementById('vistaDettaglio').classList.contains('aperta');

    if (dettaglioAperto) {
      chiudiDettaglio();
      tentativiUscita = 0;
      return;
    }

    tentativiUscita++;
    if (tentativiUscita < 3) {
      history.pushState({ vista: 'lista' }, '', location.pathname);
      mostraToast('Premi ancora Indietro ' + (3 - tentativiUscita) + ' volt' + (3 - tentativiUscita === 1 ? 'a' : 'e') + ' per uscire.');
      clearTimeout(timerResetUscita);
      timerResetUscita = setTimeout(function () { tentativiUscita = 0; }, 4000);
    }
  });

  avvio();
})();
