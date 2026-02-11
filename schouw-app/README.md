# Schouw-app - Progressive Web App for Field Inspections

A complete mobile-first Progressive Web App for municipal field inspections (schouwplaatsen) to assess locations for undermining risks, building conditions, and environmental quality.

## Features

### Core Functionality
- **Inspector Identification**: Session-based inspector name and organization login
- **6-Step Wizard**: Comprehensive inspection form with navigation
- **Location Tracking**: GPS auto-detection with postcode validation
- **Rating System**: Touch-friendly 1-5 rating controls with color coding
- **Data Persistence**: IndexedDB storage for offline capability
- **Export**: JSON export compatible with Vitaliteitstool analyzer
- **Responsive Design**: Mobile-first, 320px-768px primary, scales to desktop

### Screens

1. **Login Screen** - Inspector authentication
2. **Dashboard** - Overview of inspections with statistics and map
3. **New Inspection Wizard**
   - Step 1: Location (GPS, postcode, address)
   - Step 2: Building Assessment (condition, facade, utilities)
   - Step 3: Environment (cleanliness, green space, safety)
   - Step 4: Undermining Indicators (suspicious signals, risk scoring)
   - Step 5: Barrier Model (concealment, logistics, financial anomalies)
   - Step 6: Finalization (remarks, weather, time of day)
4. **Inspection Detail** - Full read-only view with edit/delete options
5. **Export Screen** - Data export and management

## Technical Details

### Architecture
- **Single HTML file** (~2640 lines) with embedded CSS and JavaScript
- **ES6+ syntax** with modern features (crypto.randomUUID, async/await)
- **IndexedDB** for robust offline data storage
- **Leaflet.js** for map integration via CDN
- **IBM Plex Sans** font from Google Fonts

### Data Storage
```
Database: schouw-app-db
Object Store: inspecties
Key Path: schouwId
Indices: datum (for date-range queries)
```

### Inspection Data Structure
Each inspection includes:
- **Location**: Postcode (6), street, house number/letter, GPS coordinates
- **Building (Pand)**: Condition, facade, advertising, lighting, accessibility, floors, upper usage, deviations
- **Environment (Omgeving)**: Cleanliness, green, lighting, social control, traffic, nuisance type
- **Undermining (Ondermijning)**: Suspicious signals, 10-point risk score, industry risk level, indicators
- **Barrier Model**: Concealment (1-5), logistics (1-5), financial (1-5)
- **Metadata**: Inspector name, organization, timestamp, weather, time-of-day, remarks

### Scoring
- **Building Score** = Average of condition, facade, advertising, lighting, accessibility
- **Environment Score** = Average of cleanliness, green, lighting, social control, traffic
- **Undermining Score** = Risk score (1-10)

### Export Format
JSON with the following structure:
```json
{
  "schouwplaatsen": [
    {
      "Schouw ID": "uuid",
      "Datum": "ISO timestamp",
      "Inspecteur": "Name",
      "Postcode 6": "1441AD",
      ...all inspection fields with exact Dutch headers...
    }
  ],
  "meta": {
    "exportDatum": "ISO timestamp",
    "inspecteur": "Name",
    "organisatie": "Organization",
    "appVersie": "1.0.0",
    "aantalInspecties": 5
  }
}
```

## Design System

### Colors (CSS Variables)
```css
--color-accent: #10b981        /* Green (primary) */
--color-accent-hover: #059669  /* Dark green */
--color-danger: #dc2626        /* Red */
--color-warning: #d97706       /* Orange */
--color-success: #16a34a       /* Light green */
```

### Rating Colors
- 1: Red (#ef4444)
- 2: Orange (#f97316)
- 3: Yellow (#eab308)
- 4: Light green (#84cc16)
- 5: Green (#22c55e)

### Typography
- **Font Family**: IBM Plex Sans
- **Sizes**: 12px (labels) → 28px (header)
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

### Dark Mode
- Full dark mode support with `[data-theme="dark"]`
- Theme preference stored in localStorage
- Automatic toggle button in header

## PWA Capabilities

### Service Worker
- **Offline Support**: Network-first strategy for app files, cache-first for external resources
- **Background Sync**: Framework for syncing inspections
- **Push Notifications**: Optional push notification support
- **Auto-caching**: Static assets cached on install

### Manifest
- **Standalone Display**: App runs fullscreen without browser UI
- **Icons**: SVG icons for various sizes and maskable support
- **Start URL**: Launches to dashboard
- **Shortcuts**: Quick action to start new inspection

### Meta Tags
- `viewport`: Responsive + safe area support
- `theme-color`: Brand color in browser chrome
- `apple-mobile-web-app-capable`: iOS home screen installation
- `apple-mobile-web-app-status-bar-style`: Dark translucent status bar

## Usage

### Installation
1. Place `index.html`, `manifest.json`, and `sw.js` in same directory
2. Serve over HTTPS (required for service worker)
3. Add to home screen on mobile devices

### First Use
1. Enter inspector name and organization
2. Tap "Start inspectie" to proceed to dashboard
3. Tap "+" FAB to begin new inspection

### Form Navigation
- Use tabs to jump between steps (or click prev/next buttons)
- Form state persists when navigating
- Required fields validated before proceeding
- Final step shows summary of all scores

### Data Export
- Export all, today's, or selected inspections
- JSON format compatible with Vitaliteitstool analyzer
- Automatic timestamp and metadata included

### Data Management
- View all inspections in dashboard card list
- Edit previously saved inspections
- Delete individual inspections with confirmation
- Clear all data with double confirmation

## Browser Support

- **Chrome/Edge**: Full support (service worker, IndexedDB)
- **Firefox**: Full support
- **Safari iOS**: Full support (iOS 11.3+)
- **Samsung Internet**: Full support

## Accessibility

- Touch targets minimum 44x44px
- WCAG color contrast compliant
- Semantic HTML structure
- Proper form labels and ARIA relationships
- Keyboard navigation support

## Performance

- Single HTML file loads in <2s on 4G
- Service worker enables instant repeat visits
- Minimal external dependencies (only Leaflet for maps)
- Optimized CSS animations (no expensive layouts)
- IndexedDB provides fast local data access

## Security

- No sensitive data in URLs
- IndexedDB stores data locally (not transmitted)
- XSS protection via no `eval()` or dynamic HTML injection
- CSRF protection N/A (no server communication)
- Input validation on all form fields

## Future Enhancements

- Photo attachment integration
- Bulk import from CSV
- Advanced filtering and search
- Comparison reports
- Template presets for common locations
- Multi-language support (currently Dutch)
- Real-time collaboration features

## Files

- `index.html` - Complete app (2640 lines)
- `manifest.json` - PWA manifest configuration
- `sw.js` - Service worker for offline support
- `README.md` - This documentation

## Version

**v1.0.0** - Initial release
- Complete inspection workflow
- Offline data storage
- Export functionality
- Dark mode support
- Responsive mobile design

## License

Internal use for Gemeente municipalities

---

**Contact**: Development team
**Last Updated**: 2026-02-11
