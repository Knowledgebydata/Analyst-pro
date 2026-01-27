# BIBOB Interview Pro

Progressive Web App voor interview transcriptie in BIBOB onderzoeken.

## Functies

- 🎙️ Real-time speech-to-text transcriptie
- 👥 Personen database (geïnterviewden, aanwezigen)
- 📅 Interview metadata registratie (datum, tijd, duur)
- 🌍 Meertalige ondersteuning (Nederlands, Engels, Duits, Frans)
- 🏷️ **Sprekeridentificatie** - optioneel aan/uit te zetten per interview
- 📤 Export naar BIBOB Analyst Pro desktop formaat
- 📱 Werkt offline na eerste keer laden

## Sprekeridentificatie

Met de optionele sprekeridentificatie kunt u tijdens het interview aangeven wie er spreekt. Dit werkt als volgt:

1. Zet "Sprekeridentificatie" aan bij de interview setup
2. Tijdens het interview verschijnen knoppen voor elke spreker
3. Tik op de naam van de persoon die spreekt
4. Het transcript wordt automatisch voorzien van sprekerlabels

U kunt deze functie ook uit laten - dan krijgt u een gewoon transcript zonder namen.

## Browser Ondersteuning

Spraakherkenning werkt in:
- ✅ Google Chrome
- ✅ Microsoft Edge
- ✅ Safari
- ❌ Firefox (geen Web Speech API ondersteuning)

## Installatie

### Als PWA (aanbevolen)

1. Open de app in Chrome, Edge of Safari
2. Tik op "Toevoegen aan startscherm" / "Installeren"
3. De app verschijnt als icoon op je apparaat

### Direct openen

Ga naar: https://knowledgebydata.github.io/BIBOB-Interview-Pro/

## Technologie

- Vanilla JavaScript (ES6+)
- Web Speech API voor spraakherkenning
- Service Worker voor offline functionaliteit
- LocalStorage voor data persistentie
- Geen externe dependencies (behalve Font Awesome icons)

## Beveiliging

- Alle data blijft lokaal op het apparaat
- Geen server-side opslag
- Audio wordt niet opgeslagen, alleen getranscribeerd
- Geen tracking of analytics
- HTTPS verplicht

## Licentie

© 2025 L.P. Antenbrink, Knowledge by Data. Alle rechten voorbehouden.

---

*Onderdeel van de Analyst Pro suite voor ondermijningsaanpak*
