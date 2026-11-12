/* Lecture d’une fiche de paye TOKAI COBEX (PDF), entièrement sur le téléphone.
   Rien n’est envoyé nulle part. On ne garde ni n° de sécu, ni IBAN.
   lireBulletin(pdfjsLib, octets) → { periode, ... , lignes, conges, jours } */
(function (racine) {
  const nombre = s => { const x = parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : null; };
  const estNombre = s => /^-?\d{1,3}( \d{3})*,\d+$/.test(s.trim());

  async function itemsPage(page) {
    const vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    // Certaines fiches écrivent les pages tournées lettre par lettre : on recolle les mots
    const brut = [];
    for (const i of tc.items) {
      const t = i.transform, tourne = Math.abs(t[0]) < 0.01, p = brut[brut.length - 1];
      if (tourne && p && p.tourne && Math.abs(p.t[4] - t[4]) < 0.5 && t[5] - (p.fin) < 4 && t[5] >= p.t[5] && !(i.str === " " && i.width > 3) && !(p.str.endsWith(" ") && p.large)) {
        p.str += i.str; p.fin = t[5] + i.width; continue;
      }
      brut.push({ str: i.str, t, tourne, fin: t[5] + i.width, large: i.str.trim() === "" && i.width > 3 });
    }
    return brut.filter(i => i.str.trim()).map(i => ({ x: Math.round(i.t[4]), y: Math.round(vp.height - i.t[5]), s: i.str.trim() }));
  }
  function lignesDe(items) {           // regroupe par hauteur (une ligne du bulletin)
    const t = [...items].sort((a, b) => a.y - b.y || a.x - b.x), L = [];
    for (const it of t) { const l = L.find(l => Math.abs(l.y - it.y) <= 2); if (l) l.it.push(it); else L.push({ y: it.y, it: [it] }); }
    L.forEach(l => l.it.sort((a, b) => a.x - b.x));
    return L;
  }

  /* --- partie « paye » : les rubriques et les totaux --- */
  function litPaye(L, B) {
    // colonnes, repérées sur les titres (au cas où la mise en page bouge un peu)
    const col = { q: 250, t: 303, ded: 372, pay: 432, pat: 535 };
    for (const l of L) for (const i of l.it) {
      if (i.s === "QUANTITE") col.q = i.x + 25; if (i.s === "TAUX") col.t = i.x + 11;
      if (i.s === "A DEDUIRE") col.ded = i.x + 30; if (i.s === "A PAYER") col.pay = i.x + 25; if (i.s === "MONTANT") col.pat = i.x + 20;
    }
    const proche = x => Object.entries(col).sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x))[0][0];
    for (const l0 of L) {
      const l = { y: l0.y, it: l0.it.filter(i => i.x >= 30) };   // « Code de sécurité » déborde dans la marge : on l’ignore
      if (!l.it.length) continue;
      const tete = l.it[0], txt = l.it.map(i => i.s).join(" ");
      let m;
      if ((m = /^(\d{4}) (.+)$/.exec(tete.s)) && tete.x < 60) {
        const r = { code: m[1], lib: m[2], q: 0, t: 0, ded: 0, pay: 0 };
        for (const i of l.it.slice(1)) if (estNombre(i.s)) { const k = proche(i.x); if (k !== "pat") r[k] = nombre(i.s); }
        B.lignes.push(r);
      }
      if (/^PAIE DU$/.test(tete.s)) { const d = l.it.find(i => /^\d\d\/\d\d\/\d{4}$/.test(i.s)); if (d) B.periode = d.s.slice(6) + "-" + d.s.slice(3, 5); }
      const val = () => { const n = l.it.filter(i => estNombre(i.s)); return n.length ? nombre(n[0].s) : null; };
      if (/^Salaire de base/.test(tete.s)) B.base = val();
      if (/^Taux horaire/.test(tete.s)) B.tauxHoraire = val();
      if (/^Entrée/.test(txt) || l.it.some(i => i.s === "Entrée :")) { const d = l.it.find(i => /^\d\d\/\d\d\/\d{4}$/.test(i.s)); if (d && !B.entree) B.entree = d.s.slice(6) + "-" + d.s.slice(3, 5); }
      if (tete.s === "TOTAL BRUT") B.brut = val();
      if (tete.s === "NET IMPOSABLE") B.netImposable = val();
      if (/^NET A PAYER AVANT IMPOT/.test(tete.s)) B.netAvant = val();
      if (/^Impôt sur le revenu prélevé/.test(tete.s)) { const n = l.it.filter(i => estNombre(i.s)).map(i => nombre(i.s)); if (n.length >= 3) { B.tauxImpot = n[1] / 100; B.impot = n[2]; } }
      if (/^Montant net des heures supp/.test(tete.s)) B.hsExonerees = val();
      if (tete.s === "Payé Le :") {
        const d = l.it.find(i => /^\d\d\/\d\d\/\d{4}$/.test(i.s)); if (d) B.payeLe = d.s.slice(6) + "-" + d.s.slice(3, 5) + "-" + d.s.slice(0, 2);
        const n = l.it.filter(i => estNombre(i.s) && i.x > 360 && i.x < 450); if (n.length) B.net = nombre(n[0].s);
      }
    }
  }

  /* --- tableau des congés (acquis / pris / restants) --- */
  function litConges(L, B) {
    const tete = L.find(l => l.it[0].s === "Congés" && l.it.some(i => i.s === "Reliquats"));
    if (!tete) return;
    const cols = tete.it.slice(1).filter(i => /Reliquats|Droits|CP Ancienneté|CP Médaille|RTT|CET/.test(i.s)).map(i => ({ nom: i.s, x: i.x }));
    const cle = { "Reliquats": "reliquats", "Droits": "droits", "CP Ancienneté": "cpAnc", "CP Médaille": "cpMed", "RTT": "rtt", "CET": "cet" };
    const C = {}; cols.forEach(c => C[cle[c.nom]] = { acquis: 0, pris: 0, restants: 0 });
    for (const l of L) {
      const k = l.it[0].s; if (!/^(acquis|pris|restants)$/.test(k) || l.y < tete.y || l.y > tete.y + 40) continue;
      for (const i of l.it.slice(1)) {
        if (!estNombre(i.s) || i.x > 440) continue;      // au-delà : allègement employeur, pas un compteur
        const c = cols.reduce((a, b) => Math.abs(b.x + 10 - i.x) < Math.abs(a.x + 10 - i.x) ? b : a);
        C[cle[c.nom]][k] = nombre(i.s);
      }
    }
    B.conges = C;
  }

  /* --- pages « LISTE DES POINTAGES » : une colonne = un événement d’un jour --- */
  function litPointages(items, B) {
    const yCode = (items.find(i => i.s === "HRBADG" || i.s === "PAUSE") || {}).y;
    if (yCode == null) return;
    const dates = items.filter(i => /^(Lu|Ma|Me|Je|Ve|Sa|Di) ?\d\d\/\d\d\/\d{4}$/.test(i.s)).map(i => { const s = i.s.slice(-10); return { x: i.x, d: s.slice(6) + "-" + s.slice(3, 5) + "-" + s.slice(0, 2) }; })
      .sort((a, b) => a.x - b.x);
    const heure = /^\d\d:\d\d$/;
    for (const c of items.filter(i => Math.abs(i.y - yCode) <= 2 && i.x > 130 && /^[A-Z][A-Z0-9]{1,6}$/.test(i.s))) {
      const jour = [...dates].reverse().find(d => d.x <= c.x + 2) || B._dernier; if (!jour) continue;
      const ev = { c: c.s, debut: null };
      const deb = items.filter(i => Math.abs(i.x - c.x) <= 2 && heure.test(i.s));
      // « Début » de la partie « Imputé » : le premier libellé « Début » sous les codes
      const yDeb = (items.filter(i => i.s === "Début" && i.x < 135 && i.y > yCode).sort((a, b) => a.y - b.y)[0] || {}).y;
      if (yDeb != null) { const v = deb.find(i => Math.abs(i.y - (yDeb + 5)) <= 4); if (v) ev.debut = v.s; }
      let j = B.jours.find(x => x.d === jour.d); if (!j) B.jours.push(j = { d: jour.d, ev: [] });
      if (!/^(PAUSE|HDOUCH|HTRAJE)$/.test(c.s)) j.ev.push(ev);
    }
    if (dates.length) B._dernier = dates[dates.length - 1];
  }

  async function lireBulletin(pdfjsLib, octets) {
    const doc = await pdfjsLib.getDocument({ data: octets }).promise;
    const B = { lignes: [], jours: [] };
    for (let n = 1; n <= doc.numPages; n++) {
      const items = await itemsPage(await doc.getPage(n));
      if (items.some(i => /LISTE DES POINTAGES/.test(i.s))) { litPointages(items, B); continue; }
      const L = lignesDe(items);
      litPaye(L, B); if (!B.conges) litConges(L, B);
    }
    B.jours.sort((a, b) => a.d < b.d ? -1 : 1); delete B._dernier;
    if (!B.periode || B.brut == null) throw new Error("Ce PDF ne ressemble pas à une fiche de paye.");
    return B;
  }
  racine.lireBulletin = lireBulletin;
  if (typeof module !== "undefined") module.exports = { lireBulletin, itemsPage };
})(typeof window !== "undefined" ? window : globalThis);
