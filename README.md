# Makro

Persönliche Web-App für Kalorien, Makros und Gewicht mit adaptiver Verbrauchsschätzung. Reines HTML/CSS/JavaScript ohne Build-Schritt. Projektstand und Entscheidungen: [projects/makro-app.md](../../projects/makro-app.md).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `css/app.css` | Grundgerüst, Gestaltung mit Farb-Tokens, heller und dunkler Modus |
| `js/app.js` | Oberfläche: Heute, Eintragen, Scanner, Rezepte, Fortschritt, Check-in, Einstellungen, Einrichtung |
| `js/algo.js` | Trendgewicht, Kalman-Filter für den Verbrauch, Tagesziele, Check-in-Termin |
| `js/foods.js` | Grundlebensmittel (Richtwerte) und Open-Food-Facts-Abfragen |
| `js/store.js` | Speicherung in IndexedDB, Sicherung als JSON |
| `js/scanner.js` | Kamera-Barcode-Scanner (eingebauter BarcodeDetector oder `barcode-detector@3.1.3` von jsDelivr) |
| `js/charts.js` | SVG-Diagramme mit Tooltip |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Fähigkeit und Installation auf dem Home-Bildschirm |

## Lokal ansehen

Der Vorschau-Server darf wegen des macOS-Schutzes nicht direkt aus dem Schreibtisch-Ordner lesen. Deshalb den Ordner vorher an einen anderen Ort kopieren und dort starten, z. B.:

```bash
rsync -a --delete ~/Desktop/PersonalOS/apps/makro/ /tmp/makro/ && cd /tmp/makro && python3 -m http.server 5680
```

Danach `http://127.0.0.1:5680` öffnen. Kamera und Service Worker funktionieren nur über `https` (oder `localhost`).

## Veröffentlichen

Für die Nutzung auf dem Handy muss der Ordner per `https` erreichbar sein, z. B. über GitHub Pages. Veröffentlicht wird nur dieser Ordner; er enthält keine persönlichen Daten. Der Service Worker lädt zuerst aus dem Netz, Änderungen kommen also beim nächsten Öffnen mit Internet an. Neue Dateien in die Liste `SHELL` in `sw.js` aufnehmen und dann `CACHE` hochzählen.

## Daten

Alle Einträge bleiben im Browser des Geräts. Auf dem iPhone sind die Daten der Home-Bildschirm-App und die in Safari getrennt. Sicherung über Einstellungen → „Sicherung erstellen“.
