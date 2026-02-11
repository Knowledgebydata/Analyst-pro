# Schouw-app Quick Start Guide

## Installation & Setup (5 minutes)

### Requirements
- HTTPS server (service worker requires secure context)
- Modern browser (Chrome, Firefox, Safari iOS, Edge)
- No external dependencies - everything is self-contained

### Steps
1. Upload these 3 files to your web server:
   - `index.html` - Main app (107 KB)
   - `manifest.json` - PWA metadata
   - `sw.js` - Service worker

2. Ensure HTTPS is enabled
3. Open in browser: `https://yourdomain.com/path/to/index.html`
4. Install to home screen (supported on iOS and Android)

## First Inspection (3 minutes)

### Login
1. Enter your name (e.g., "Jan de Vries")
2. Enter your organization (e.g., "Gemeente Purmerend")
3. Tap "Start inspectie"

### Step 1: Location
- **GPS**: Tap "📍 Detecteer GPS-locatie" (optional)
- **Postcode**: Enter 6-character format (e.g., 1441AD)
- **Street**: Enter street name
- **House Number**: Enter number
- **House Letter**: Optional (e.g., A)
- Small map shows location in real-time

### Step 2: Building (Pand)
- Rate 5 aspects (1=poor, 5=excellent):
  - Condition (required)
  - Facade (required)
  - Advertising (optional)
  - Lighting (optional)
  - Accessibility (optional)
- Enter floors and upper-level usage
- Note any deviations (optional)

### Step 3: Environment (Omgeving)
- Rate 5 environmental factors:
  - Cleanliness (required)
  - Green space (optional)
  - Lighting (required)
  - Social control (required)
  - Traffic (optional)
- Report nuisance if observed (optional)

### Step 4: Undermining (Ondermijning)
- Toggle "Verdachte signalen" if suspicious
- Select applicable indicators from 10 options
- Adjust risk score slider (1-10)
- Select industry risk level (laag/gemiddeld/hoog/zeer hoog)

### Step 5: Barrier Model
- Rate 3 aspects based on visible signals:
  - Concealment/screening (1-5)
  - Logistical anomalies (1-5)
  - Financial anomalies (1-5)

### Step 6: Finalization
- Add remarks (optional)
- Select weather conditions (auto-detects)
- Time of day auto-calculated (editable)
- Review score summary
- Tap "✓ Opslaan" to save

## Dashboard Features

### Statistics
- **Vandaag**: Count of inspections today
- **Totaal**: All inspections
- **Gem. pand**: Average building score

### Map
- Shows all completed inspections with GPS
- Click markers for details

### Recent Inspections
- Last 10 inspections in reverse date order
- Tap card to view details
- Edit or delete from detail view

### Export Data
- **All**: Export all saved inspections
- **Today**: Export only today's work
- **Selection**: Choose specific inspections
- JSON format compatible with Vitaliteitstool

## Rating Scale Reference

### Building/Environment Ratings (1-5)
- **1** (Red): Poor, needs improvement
- **2** (Orange): Below average
- **3** (Yellow): Average
- **4** (Light Green): Good
- **5** (Green): Excellent

### Risk Score (1-10)
- **1-3**: Low risk
- **4-6**: Medium risk
- **7-8**: High risk
- **9-10**: Very high risk

## Tips & Tricks

### Form Navigation
- Tap step numbers to jump between steps
- Form state saves automatically as you fill it
- Required fields are marked with *
- Click "Volgende" to move forward
- Validation prevents moving without required fields

### Offline Work
- App works completely offline
- All data stored locally on device
- Export data when you have internet

### Dark Mode
- Click moon icon (🌙) in header
- Theme preference saved automatically
- Useful for outdoor work

### Editing Inspections
1. Go to Dashboard
2. Tap an inspection card
3. Tap "✎ Bewerk" button
4. Make changes in wizard
5. Tap "✓ Opslaan" to update

### Deleting Data
- **Single inspection**: Open detail view → "🗑 Verwijder"
- **All data**: Export screen → "🗑 Wis alle data" (requires double confirmation)

## Data Export Format

The exported JSON includes:
```json
{
  "schouwplaatsen": [
    {
      "Schouw ID": "unique-id",
      "Datum": "2026-02-11T14:30:00.000Z",
      "Inspecteur": "Your Name",
      "Postcode 6": "1441AD",
      "Straat": "Kaasmarkt",
      ...all other fields...
    }
  ],
  "meta": {
    "exportDatum": "2026-02-11T15:00:00.000Z",
    "inspecteur": "Your Name",
    "organisatie": "Your Organization",
    "appVersie": "1.0.0",
    "aantalInspecties": 1
  }
}
```

This JSON can be imported into the Vitaliteitstool analyzer.

## Common Issues

### "GPS not available"
- Allow location permission in browser settings
- GPS requires HTTPS connection
- Works best outdoors with clear sky

### "Service worker failed"
- App requires HTTPS (not HTTP)
- Check browser console for errors
- Clear cache: DevTools → Application → Clear all

### Postcode validation fails
- Format: 4 digits + 2 uppercase letters
- Example: 1441AD (not 1441ad or 1441 ad)

### Data not saving
- Check browser's IndexedDB storage limit
- Clear old unused inspections
- Try exporting and clearing all, then re-importing

### Map not loading
- Requires internet connection (CDN resources)
- Leaflet loads from: cdnjs.cloudflare.com
- Ensure firewalls don't block CDN

## Keyboard Shortcuts

While form field is focused:
- Tab: Move to next field
- Shift+Tab: Move to previous field
- Enter: In textarea, use Ctrl+Enter or tap button

## Permissions Required

- **Location**: For GPS detection (optional, can be skipped)
- **IndexedDB**: For local data storage (automatic)
- **Service Worker**: For offline support (automatic)

All permissions are optional and the app functions fully without them.

## Best Practices

1. **Postcode Validation**: Double-check PC6 format before proceeding
2. **GPS Timing**: Allow 5-10 seconds for GPS to acquire signal
3. **Backup**: Export data regularly as backup
4. **Offline**: Work offline, export when internet available
5. **Comments**: Use remarks section for context about conditions

## Support

For issues or feature requests:
- Check this guide first
- Clear browser cache and try again
- Verify HTTPS is enabled
- Check browser console (F12) for errors
- Export data before clearing/reinstalling

---

**Last Updated**: 2026-02-11
**App Version**: 1.0.0
