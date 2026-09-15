(function () {
  var CHIAVE_LOCALSTORAGE = 'pannelloAdminHash';

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
  // Applicato a qualunque pulsante con testo: lo disabilita (comportamento
  // già presente), ma ora anche cambia visibilmente aspetto e testo, così
  // è sempre chiaro se un tocco ha avuto effetto o no — specialmente
  // utile ora che ogni azione può richiedere qualche secondo (il file
  // delle licenze va letto, decifrato, modificato, cifrato e riscritto ad
  // ogni salvataggio).
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

  // ---------------- CALCOLO HASH (mai la password in chiaro sulla rete) ----------------
  async function calcolaHash(password) {
    var dati = new TextEncoder().encode(password + SALE_ADMIN);
    var hashBuffer = await crypto.subtle.digest('SHA-256', dati);
    return Array.from(new Uint8Array(hashBuffer)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ---------------- CHIAMATE AL SERVER (con riprova automatica) ----------------
  //
  // Stessa logica già usata nel programma PC (lib/rete.js): fino a 4
  // tentativi in background, con una pausa crescente tra uno e l'altro,
  // prima di mostrare un errore vero. Utile soprattutto per il primo
  // avvio "a freddo" di Apps Script dopo un periodo di inattività, che
  // può essere più lento del solito.
  var TENTATIVI_MASSIMI = 4;
  var TIMEOUT_MS = 15000;

  function attesa(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function chiamaServerUnaVolta(azione, corpo) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(URL_SCRIPT + '?azione=' + encodeURIComponent(azione), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('Il server ha risposto con errore HTTP ' + r.status);
      return r.json();
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  async function chiamaServer(azione, corpo) {
    var ultimoErrore;
    for (var tentativo = 1; tentativo <= TENTATIVI_MASSIMI; tentativo++) {
      try {
        return await chiamaServerUnaVolta(azione, corpo);
      } catch (err) {
        ultimoErrore = err;
        if (tentativo < TENTATIVI_MASSIMI) await attesa(700 * tentativo);
      }
    }
    throw ultimoErrore;
  }

  var hashCorrente = localStorage.getItem(CHIAVE_LOCALSTORAGE) || '';
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
      var hash = await calcolaHash(valore);
      var d = await chiamaServer('adminVerificaPassword', { hash: hash });
      if (!d.successo) {
        errore.textContent = d.errore || 'Password errata.';
        return;
      }
      hashCorrente = hash;
      localStorage.setItem(CHIAVE_LOCALSTORAGE, hash);
      document.getElementById('inputPassword').value = '';
      entraNelPannello();
    } catch (e) {
      errore.textContent = 'Impossibile contattare il server. Controlla la connessione.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Accedi';
      nascondiOverlayCaricamento();
    }
  }

  document.getElementById('btnAccedi').addEventListener('click', provaLogin);
  document.getElementById('inputPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') provaLogin(); });

  document.getElementById('btnEsci').addEventListener('click', function () {
    localStorage.removeItem(CHIAVE_LOCALSTORAGE);
    hashCorrente = '';
    mostraVista('login');
  });

  document.getElementById('btnRicaricaElenco').addEventListener('click', function () {
    caricaElenco();
    mostraToast('Elenco aggiornato.');
  });

  function entraNelPannello() {
    mostraVista('lista');
    caricaElenco();
    // Stabilisce la schermata "lista" come base della cronologia: da qui
    // in poi il tasto/gesto Indietro del telefono viene gestito da noi
    // (vedi popstate più sotto), invece di uscire subito dall'app.
    history.replaceState({ vista: 'lista' }, '', location.pathname);
  }

  // Se il telefono ha già una sessione salvata (opzione "ricordami"),
  // proviamo a entrare direttamente, verificando comunque che la password
  // non sia stata cambiata nel frattempo (l'hash salvato potrebbe non
  // essere più valido).
  async function avvio() {
    if (!hashCorrente) { mostraVista('login'); return; }
    try {
      var d = await chiamaServer('adminVerificaPassword', { hash: hashCorrente });
      if (d.successo) { entraNelPannello(); return; }
    } catch (e) { /* problema di rete: proviamo comunque a mostrare la lista con dati eventualmente in cache */ }
    localStorage.removeItem(CHIAVE_LOCALSTORAGE);
    hashCorrente = '';
    mostraVista('login');
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
      var d = await chiamaServer('adminElencoAziende', { hash: hashCorrente });
      if (!d.successo) {
        if ((d.errore || '').toLowerCase().indexOf('password') !== -1) {
          mostraToast('Sessione scaduta, effettua di nuovo l\'accesso.');
          localStorage.removeItem(CHIAVE_LOCALSTORAGE);
          hashCorrente = '';
          mostraVista('login');
          return;
        }
        document.getElementById('listaAziendeBody').innerHTML = '<div class="lista-vuota-admin">' + esc(d.errore || 'Errore nel caricamento.') + '</div>';
        return;
      }
      aziende = d.aziende || [];
      renderLista();
    } catch (e) {
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
            // Stesso motivo del dettaglio: se prima era revocata, la
            // sincronizzazione va riaccesa esplicitamente, non lasciata
            // al vecchio valore che la revoca aveva forzato a spento.
            payload.sincronizzazioneAbilitata = true;
          }
          var d = await chiamaServer('adminSalvaAzienda', { hash: hashCorrente, azienda: payload });
          if (!d.successo) { mostraToast(d.errore || 'Errore.'); sw.checked = !sw.checked; return; }
          aziende = d.aziende;
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
    apriVistaDettaglio({ codice: generaCodice(), cliente: '', stato: 'attivo', scadenza: '', motivo: '', dispositivi: [], limiteDispositivi: null, note: '', sincronizzazioneAbilitata: true }, 'Nuova azienda', 'Compila i dati e crea la licenza');
  });

  // ---------------- DETTAGLIO / MODIFICA ----------------
  function apriDettaglio(codice) {
    modalitaDettaglio = 'modifica';
    codiceAziendaAperta = codice;
    var a = aziende.find(function (x) { return x.codice === codice; });
    apriVistaDettaglio(a, a.cliente, 'Codice ' + a.codice);
    caricaInfoArchivio(codice);
  }

  function apriVistaDettaglio(a, titolo, sottotitolo) {
    document.getElementById('dettaglioTitolo').textContent = titolo || 'Azienda';
    document.getElementById('dettaglioSottotitolo').textContent = sottotitolo || '';
    document.getElementById('dettaglioCorpo').innerHTML = costruisciCorpoDettaglio(a);
    collegaEventiDettaglio(a);
    document.getElementById('vistaDettaglio').classList.add('aperta');
    // Registriamo questa apertura nella cronologia del browser, così il
    // gesto/tasto "Indietro" del telefono chiude il dettaglio invece di
    // uscire dall'app (vedi gestione popstate più sotto).
    history.pushState({ vista: 'dettaglio' }, '', location.pathname);
  }

  document.getElementById('btnIndietroDettaglio').addEventListener('click', function () {
    history.back(); // fa scattare il gestore popstate qui sotto, che chiude davvero la vista
  });
  function chiudiDettaglio() {
    document.getElementById('vistaDettaglio').classList.remove('aperta');
  }

  async function caricaInfoArchivio(codice) {
    var el = document.getElementById('infoSincronizzazione');
    if (!el) return;
    try {
      var d = await chiamaServer('adminInfoArchivioAzienda', { hash: hashCorrente, codice: codice });
      if (!d.successo) { el.textContent = 'Non disponibile.'; return; }
      if (!d.esiste) { el.textContent = 'Nessun dato ancora sincronizzato.'; return; }
      el.textContent = formattaOraRelativa(d.ultimoAggiornamento) + ' — ' + d.numeroProdotti + ' prodotti, ' + d.numeroMovimenti + ' movimenti registrati';
    } catch (e) {
      el.textContent = 'Non disponibile (problema di connessione).';
    }
  }

  function costruisciListaDispositivi(dispositivi) {
    if (!dispositivi || dispositivi.length === 0) {
      return '<div class="nota-dispositivo"><span class="valore assente">Nessun dispositivo collegato ancora</span></div>';
    }
    return dispositivi.map(function (id) {
      return '<div class="nota-dispositivo" style="margin-bottom:6px">' +
        '<span class="valore">' + esc(id) + '</span>' +
        '<button class="btn-piccolo" data-rimuovi-dispositivo="' + esc(id) + '">Rimuovi</button>' +
        '</div>';
    }).join('');
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
        '<div class="campo-gruppo"><label>Dispositivi collegati (' + (a.dispositivi || []).length + ')</label>' +
          '<div id="listaDispositivi">' + costruisciListaDispositivi(a.dispositivi || []) + '</div>' +
        '</div>' +
        '<div class="campo-gruppo"><label>Sincronizzazione condivisa</label><div class="info-sync" id="infoSincronizzazione">Caricamento...</div></div>'
      ) : '') +
      '<div class="campo-gruppo"><label>Note interne (solo per te)</label><textarea id="campoNote" placeholder="Annotazioni private su questo cliente...">' + esc(a.note) + '</textarea></div>' +
      '<button class="btn-salva" id="btnSalvaAzienda">' + (modalitaDettaglio === 'nuova' ? 'Crea azienda' : 'Salva modifiche') + '</button>' +
      (mostraCampiExtra ? (
        '<div class="zona-pericolo">' +
          '<label>Zona pericolosa</label>' +
          '<button class="btn-pericolo" id="btnEliminaDati">Elimina dati archiviati su GitHub</button>' +
          '<div class="conferma-pericolo" id="confermaDati">' +
            '<p>Cancella per sempre l\'archivio cifrato di questa azienda (prodotti, giacenze, fatture). Al prossimo avvio, il PC del cliente si svuoterà. Non è recuperabile.</p>' +
            '<div class="riga-bottoni"><button class="btn-annulla-pericolo" data-annulla="confermaDati">Annulla</button><button class="btn-conferma-pericolo" data-conferma="dati">Elimina definitivamente</button></div>' +
          '</div>' +
          '<button class="btn-pericolo" id="btnEliminaAzienda">Elimina azienda</button>' +
          '<div class="conferma-pericolo" id="confermaAzienda">' +
            '<p>Rimuove anche il codice licenza: il cliente non potrà più accedere con questo codice. Usalo solo se l\'azienda non è più tua cliente.</p>' +
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
            // Se stiamo uscendo da "Revocato", riaccendi sempre la
            // sincronizzazione di default: la revoca l'aveva spenta di
            // proposito, e lasciarla spenta "per sbaglio" dopo la
            // riattivazione lascerebbe il cliente bloccato senza motivo
            // apparente. L'amministratore può comunque rispegnerla a
            // mano subito dopo, se lo vuole davvero.
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

    document.querySelectorAll('[data-rimuovi-dispositivo]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        impostaCaricamento(btn, '...');
        mostraOverlayCaricamento('Rimozione dispositivo...');
        try {
          var d = await chiamaServer('adminRimuoviDispositivo', { hash: hashCorrente, codice: a.codice, idDispositivo: btn.dataset.rimuoviDispositivo });
          if (!d.successo) { mostraToast(d.errore || 'Errore.'); return; }
          aziende = d.aziende;
          mostraToast('Dispositivo rimosso: il cliente potrà registrarne uno nuovo.');
          apriDettaglio(a.codice);
        } catch (e) {
          mostraToast('Impossibile contattare il server.');
        } finally {
          nascondiOverlayCaricamento();
        }
      });
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
        var d = await chiamaServer('adminSalvaAzienda', { hash: hashCorrente, azienda: datiAggiornati });
        if (!d.successo) { mostraToast(d.errore || 'Errore nel salvataggio.'); return; }
        aziende = d.aziende;
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
            var d1 = await chiamaServer('adminEliminaDatiAzienda', { hash: hashCorrente, codice: a.codice });
            if (!d1.successo) { mostraToast(d1.errore || 'Errore.'); return; }
            mostraToast('Dati archiviati eliminati.');
            document.getElementById('confermaDati').classList.remove('visibile');
            caricaInfoArchivio(a.codice);
          } else if (btn.dataset.conferma === 'azienda') {
            var d2 = await chiamaServer('adminEliminaAzienda', { hash: hashCorrente, codice: a.codice });
            if (!d2.successo) { mostraToast(d2.errore || 'Errore.'); return; }
            aziende = d2.aziende;
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
  //
  // Senza questo, il gesto "Indietro" di Android chiude direttamente
  // l'app (non c'è una vera pagina precedente a cui tornare, essendo
  // tutto su una sola pagina). Con la cronologia sintetica che abbiamo
  // costruito sopra (un "gradino" per l'apertura del dettaglio, uno per
  // la schermata base "lista"), possiamo intercettare il gesto:
  //   - se il dettaglio è aperto -> lo chiudiamo, non usciamo
  //   - se siamo già sulla lista -> serve premere Indietro 3 volte di
  //     fila (entro pochi secondi) per uscire davvero, altrimenti
  //     ripristiniamo il "gradino" e mostriamo quante volte mancano
  //
  // NOTA: il comportamento esatto del gesto di sistema (rispetto al
  // tasto fisico/virtuale Indietro) può variare leggermente tra modelli
  // e versioni di Android — vale la pena provarlo davvero sul telefono
  // dopo aver pubblicato, questo è un meccanismo standard ma non posso
  // verificarlo io stesso su un dispositivo Android reale da qui.
  var tentativiUscita = 0;
  var timerResetUscita = null;

  window.addEventListener('popstate', function (e) {
    var dettaglioAperto = document.getElementById('vistaDettaglio').classList.contains('aperta');

    if (dettaglioAperto) {
      chiudiDettaglio();
      tentativiUscita = 0; // tornare al dettaglio resetta il conteggio di uscita
      return;
    }

    // Siamo sulla schermata base: contiamo questo come un tentativo di uscita.
    tentativiUscita++;
    if (tentativiUscita < 3) {
      // Ripristiniamo il "gradino" così il prossimo Indietro non esce per davvero.
      history.pushState({ vista: 'lista' }, '', location.pathname);
      mostraToast('Premi ancora Indietro ' + (3 - tentativiUscita) + ' volt' + (3 - tentativiUscita === 1 ? 'a' : 'e') + ' per uscire.');
      clearTimeout(timerResetUscita);
      timerResetUscita = setTimeout(function () { tentativiUscita = 0; }, 4000);
    }
    // Alla terza volta non ripristiniamo nulla: il prossimo gesto uscirà davvero dall'app.
  });

  avvio();
})();
