# 🤖 SPIKE WhatsApp Bot — Guida all'installazione

## Cosa fa questo bot
- Ogni mattina alle **09:00** controlla automaticamente:
  - 🎂 Se qualcuno compie gli anni → manda gli auguri nel gruppo
  - 🗓️ Se è una festività (Natale, Pasqua, ecc.) → manda il messaggio di auguri

---

## Requisiti
- **Node.js** v18 o superiore → https://nodejs.org
- **Google Chrome** (usato internamente da whatsapp-web.js)
- Computer o server **sempre acceso**

---

## Installazione (una tantum)

```bash
# 1. Entra nella cartella del bot
cd spike-whatsapp-bot

# 2. Installa le dipendenze
npm install

# 3. Avvia il bot
npm start
```

Alla prima esecuzione apparirà un **QR code** nel terminale.  
Aprire WhatsApp → Menu → Dispositivi collegati → Collega un dispositivo → scansiona il QR.

✅ Da quel momento il bot rimane attivo e autonomo.

---

## Configurazione (nel file index.js, riga CONFIG)

| Parametro | Descrizione | Default |
|-----------|-------------|---------|
| `GROUP_NAME` | Nome **esatto** del gruppo WhatsApp | `SPIKE RM 🏛️` |
| `SEND_TIME` | Orario invio (formato cron) | `0 9 * * *` = ogni giorno alle 09:00 |

---

## Gestione compleanni — `data/compleanni.xlsx`

| Colonna | Descrizione |
|---------|-------------|
| **Nome** | Nome della persona |
| **Cognome** | Cognome |
| **Compleanno** | Formato `25/12` (giorno/mese) oppure `25/12/1990` |
| **Telefono** | Numero (opzionale, solo per riferimento) |
| **Attivo** | `SI` = attivo, `NO` = ignorato dal bot |
| **Template_personalizzato** | Lasciare vuoto per messaggio standard. Puoi scrivere un testo custom con `{Nome}` e `{Cognome}` come variabili |

> Per **rimuovere** qualcuno: mettere `NO` nella colonna Attivo (non cancellare la riga)

---

## Gestione ricorrenze — `data/ricorrenze.xlsx`

| Colonna | Descrizione |
|---------|-------------|
| **Ricorrenza** | Nome della festività |
| **Data** | Formato `25/12` (giorno/mese) |
| **Attivo** | `SI` / `NO` |
| **Messaggio** | Testo completo del messaggio da inviare |

> Le date di **Pasqua e Pasquetta** cambiano ogni anno: ricordarsi di aggiornarle a gennaio!

---

## Mantenere il bot sempre attivo

### Opzione A — PC/Mac sempre acceso
```bash
npm start
```
Lasciare il terminale aperto.

### Opzione B — Server Linux (consigliato, usa PM2)
```bash
npm install -g pm2
pm2 start index.js --name spike-bot
pm2 save
pm2 startup   # Per far ripartire automaticamente al reboot
```

### Opzione C — Servizio cloud gratuito
Usare **Railway** (railway.app) o **Render** (render.com) — upload del progetto e avvio automatico.

---

## Nota su Pasqua
La Pasqua ha una data variabile ogni anno. Nel file `ricorrenze.xlsx` è preimpostata al 20/04.  
**Aggiornare la data ogni anno a gennaio.**

