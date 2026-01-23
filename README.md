# Dublin Public Bathroom Finder 🚻

A comprehensive web application to find public bathrooms across Dublin, Ireland.

![Dublin Bathroom Finder](https://img.shields.io/badge/Status-Live-success)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- 📍 **Interactive Map** - Browse 15+ public bathroom locations on an interactive map
- 🔍 **Smart Search** - Search bathrooms by name or location
- 🎯 **Advanced Filters** - Filter by Free, Accessible, or 24-Hour availability
- ♿ **Accessibility Info** - Clear indicators for wheelchair-accessible facilities
- 🗺️ **Get Directions** - One-click directions via Google Maps
- 📱 **Mobile Responsive** - Works perfectly on all devices

## Live Demo

🌐 **GitHub Pages**: `https://timwcash.github.io/dashboard/`

Simply open the link above to start using the app!

## Locations Included

The app features 15 public bathroom locations across Dublin:

- St. Stephen's Green
- Temple Bar Square
- O'Connell Street
- Phoenix Park
- Grafton Street
- Trinity College
- Merrion Square
- Dublin Castle
- Smithfield Square
- Grand Canal Dock
- Parnell Street (24hrs)
- Christchurch Cathedral
- Herbert Park
- Busáras Bus Station (24hrs)
- Docklands Riverside

## Technology Stack

- **Mapping**: Leaflet.js + OpenStreetMap
- **Frontend**: Vanilla JavaScript (no frameworks needed)
- **Styling**: Modern CSS with custom properties
- **Fonts**: Google Fonts (Inter)

## Local Usage

1. Clone this repository
2. Open `index.html` in any modern web browser
3. No build process or dependencies required!

## Features Breakdown

### Search & Filter
- Real-time search across bathroom names and locations
- Filter by accessibility features
- Filter by cost (free vs paid)
- Filter by operating hours (24-hour availability)

### Map Features
- Color-coded markers (Blue: Accessible, Green: Free, Yellow: Paid)
- Custom popup with bathroom details
- Click markers to view information
- Synchronized sidebar selection

### Bathroom Information
Each location includes:
- Name and full address
- Accessibility status
- Cost information
- Operating hours
- Special features (baby changing, parking, etc.)

## Sharing the App

### Option 1: GitHub Pages (Recommended)
1. Go to your repository settings on GitHub
2. Navigate to "Pages" in the left sidebar
3. Under "Source", select your branch: `claude/dublin-bathroom-finder-dqxSF`
4. Click "Save"
5. Your app will be live at: `https://timwcash.github.io/dashboard/`

### Option 2: Other Hosting Services
You can also deploy to:
- **Netlify**: Drag and drop the folder
- **Vercel**: Connect your GitHub repo
- **Cloudflare Pages**: Direct GitHub integration
- **Surge.sh**: Run `surge` in the project directory

### Share Links
Once published, share your app via:
- Direct URL
- QR Code (generate at qr-code-generator.com)
- Social media
- Email

## Browser Support

Works on all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

Potential improvements:
- User location detection
- Route planning between bathrooms
- User reviews and ratings
- Opening hours validation
- Offline support (PWA)
- More bathroom locations

## Contributing

Want to add more bathroom locations? Edit the `bathrooms` array in `index.html` with:

```javascript
{
    id: 16,
    name: "New Location Name",
    lat: 53.xxxx,    // Latitude
    lng: -6.xxxx,    // Longitude
    address: "Full Address, Dublin",
    type: "free",    // or "paid"
    accessible: true, // or false
    hours24: false,   // or true
    features: ["Free", "Accessible", "Feature Name"]
}
```

## License

MIT License - feel free to use and modify!

## Credits

Built with:
- [Leaflet](https://leafletjs.com/) - Interactive maps
- [OpenStreetMap](https://www.openstreetmap.org/) - Map tiles
- Public bathroom data sourced from Dublin City Council

---

**Made with ❤️ for Dublin residents and visitors**

Need to update bathroom information? Found a new location? Open an issue or pull request!
