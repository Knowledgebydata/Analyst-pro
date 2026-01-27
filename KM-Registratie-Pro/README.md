# KM Registratie Pro

Progressive Web App voor sluitende kilometerregistratie - speciaal voor DGA's en ondernemers.

## Functies

- 📍 **GPS-registratie** - Automatische locatieopname bij start en einde
- 🚗 **Kilometerstand validatie** - Controle dat begin- en eindstand logisch zijn
- 📊 **Sluitende administratie** - Voldoet aan eisen Belastingdienst
- 🏙️ **300+ Nederlandse plaatsen** - Snel selecteren met autocomplete
- ⏱️ **Automatische tijdregistratie** - Start/eindtijd en duur
- 📤 **CSV Export** - Voor boekhouding en belastingaangifte
- 📱 **Werkt offline** - Na eerste keer laden

## Geregistreerde gegevens per rit

- Datum en tijdstip vertrek
- Datum en tijdstip aankomst
- Kilometerstand bij vertrek
- Kilometerstand bij aankomst
- Gereden kilometers (automatisch berekend)
- Vertrekplaats
- Bestemming
- Doel van de rit
- GPS-coördinaten start (latitude, longitude, nauwkeurigheid)
- GPS-coördinaten einde
- Rijtijd

## Validaties

De app controleert automatisch:
- Eindstand moet hoger zijn dan beginstand
- Gemiddelde snelheid (waarschuwing bij >150 km/u of <5 km/u)
- Continuïteit met vorige rit (beginstand moet aansluiten)

## Kilometervergoeding 2024/2025

Het wettelijk maximum voor onbelaste kilometervergoeding is **€0,23 per kilometer**.

## Installatie

### Als PWA (aanbevolen)

1. Open de app in Chrome, Edge of Safari
2. Tik op "Toevoegen aan startscherm" / "Installeren"
3. De app verschijnt als icoon op je apparaat

### Direct openen

Ga naar: https://knowledgebydata.github.io/KM-Registratie-Pro/

## Privacy & Beveiliging

- Alle data blijft lokaal op uw apparaat (localStorage)
- Geen server-side opslag
- Geen tracking of analytics
- GPS-data wordt alleen lokaal opgeslagen
- HTTPS verplicht

## Export

- **CSV**: Voor Excel/boekhouding met puntkomma-scheiding
- **JSON**: Complete backup voor herstel of migratie

## Licentie

© 2025 L.P. Antenbrink, Knowledge by Data. Alle rechten voorbehouden.
