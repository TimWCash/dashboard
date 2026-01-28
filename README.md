# Service Physics Resource Dashboard

A simple, self-contained dashboard for tracking resource allocations, sales pipeline, and recruitment.

## Quick Start

1. **Open the dashboard**: Double-click `index.html` or open it in any web browser
2. **Upload your data**: Click "Upload Data" and select your Excel file
3. **That's it!** Your data is saved in your browser and persists between sessions

## Features

- Resource allocation tracking by client
- Sales pipeline visualization
- Recruitment candidate tracking
- Gantt chart for contract timelines
- Export to Excel/CSV
- Works offline - no server required
- Data persists in your browser's local storage

## Excel File Format

Your Excel file should have the following sheets:

### 1. Allocations Sheet
| Column | Required | Description |
|--------|----------|-------------|
| Resource | Yes | Person's name |
| Client | Yes | Client name |
| Role | Yes | EL (Engagement Lead), PL (Project Lead), Special, or TBH (To Be Hired) |
| Allocation % | No | Percentage allocation (default: 100) |
| Status | No | Active, In Transition, or To Be Hired |
| Contract | No | Contract name (defaults to Client) |
| Team | No | Team name |
| Supporting Resource | No | Supporting resource name |
| Supporting Principal | No | Principal name |
| Notes | No | Any notes |

### 2. Sales Pipeline Sheet
| Column | Required | Description |
|--------|----------|-------------|
| Client | Yes | Client/prospect name |
| Project | No | Project name |
| Probability | No | Win probability (0-100) |
| Status | No | Pipeline status |

### 3. Recruitment Sheet
| Column | Required | Description |
|--------|----------|-------------|
| Name | Yes | Candidate name |
| Position | No | Position being hired for |
| Stage | No | New, Screening, Interview, Technical, Offer, Hired, or Rejected |
| Notes | No | Any notes |

### 4. Contracts Sheet (Optional - for Gantt chart)
| Column | Required | Description |
|--------|----------|-------------|
| Name | Yes | Client/contract name |
| Start Date | No | Contract start date |
| End Date | No | Contract end date |

## Getting the Template

Click "Upload Data" then "Download Template" to get a pre-formatted Excel file with sample data.

## Transferring to Someone Else

To hand off this dashboard:

1. Share this folder (contains `index.html` and `README.md`)
2. Share your current Excel data file
3. The new person opens `index.html` and uploads the Excel file

**No accounts, servers, or technical setup required.**

## Data Storage

- Data is stored in your browser's localStorage
- Each browser/computer has its own data
- To share data between computers, export to Excel and re-import
- Click "Clear Data" to remove all stored data

## Troubleshooting

**Dashboard shows no data**
- Click "Upload Data" and select your Excel file
- Make sure your Excel file has sheets named "Allocations", "Sales Pipeline", or "Recruitment"

**Data not saving**
- Make sure you're not in private/incognito mode
- Check that localStorage is enabled in your browser

**Excel file not working**
- Download the template and copy your data into it
- Make sure column headers match exactly

## Browser Support

Works in all modern browsers:
- Chrome
- Firefox
- Safari
- Edge

## Version History

- **v1.0.0** - Excel-based data source (no external APIs)
