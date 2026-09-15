// config.js
//
// 1. URL_SCRIPT: incolla qui l'indirizzo del tuo Apps Script (lo stesso
//    già usato dal programma PC e dalla pagina "Nuovo Prodotto"), quello
//    che finisce in /exec.
//
// 2. SALE_ADMIN: NON è un segreto (un "sale" crittografico serve solo a
//    rendere l'hash unico per questa installazione, non a nasconderlo).
//    Deve essere IDENTICO al valore SALT che hai copiato nei log quando
//    hai eseguito generaHashPassword() in Apps Script, e allo stesso
//    valore che hai messo nella proprietà ADMIN_PASSWORD_SALT.
//
// La password vera non va MAI scritta in questo file, né da nessun'altra
// parte: viene digitata ogni volta (o ricordata cifrata dal telefono) e
// trasformata subito in un hash prima di essere inviata.

var URL_SCRIPT = "https://script.google.com/macros/s/AKfycbwRMfpVc_2spcYtJ6WBY_rMe4jhM2C2lqClRwnqM9HbJztA2Czdx5-Gn2vNHVlImGUfsw/exec";
var SALE_ADMIN = "0f6f36e8-820d-4c1f-9ceb-50b62c438660";
