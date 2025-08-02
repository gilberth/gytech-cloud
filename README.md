---

GYTECH Cloud is a self-hosted file sharing platform and an alternative for WeTransfer.

## ✨ Features

### Core Sharing
- **Automatic file upload** - Files upload immediately upon selection
- **Direct download URLs** - Friendly URLs with filenames (`/files/{id}/filename.ext`)
- **Smart download logic** - Direct links for single files, ZIP for multiple files
- Unlimited file size (restricted only by disk space)
- Set an expiration date for shares
- Secure shares with visitor limits and passwords
- Email recipients
- Reverse shares

### User Experience
- **Advanced shares management** - Comprehensive file organization with search, filtering, and bulk operations
- **Smart file recognition** - Specific icons for PDF, Word, Excel, PowerPoint with extension badges
- **Real image previews** - 40px thumbnails for uploaded images with detailed tooltips
- **Streamlined interface** - No manual "Share" button required, instant uploads
- **Quick Share Mode** - One-click sharing with intelligent defaults for rapid file distribution
- **Rich content previews** - Enhanced share landing pages with image galleries and file categorization

### Authentication & Security  
- OIDC and LDAP authentication
- Integration with ClamAV for security scans
- Password protection and visitor limits

### Storage Options
- Different file providers: local storage and S3
- Configurable upload settings and file handling

## 🐧 Get to know GYTECH Cloud

## 🚀 Recent Improvements

### Advanced Shares Management
- **Intelligent search**: Real-time file search across names, extensions, and content with debounced filtering
- **Status indicators**: Visual badges for share states (Active, Expired, Expiring Soon, View Limit Reached)
- **Bulk operations**: Multi-select with batch delete functionality and progress tracking
- **Mobile-responsive design**: Adaptive card layout for seamless mobile file management
- **Enhanced accessibility**: Color-blind friendly design with shape and text differentiation

### Smart File Recognition System  
- **Document-specific icons**: Distinct icons for PDF (red), Word (blue), Excel (green), PowerPoint (orange)
- **Extension badges**: Small overlays showing file extensions (PDF, DOCX, XLSX) for instant identification
- **Rich tooltips**: Hover information with file type descriptions and sizes
- **Improved visual hierarchy**: Better organization of file information in limited space

### Quick Share Mode
- **One-click sharing**: Bypass configuration modal with intelligent defaults for rapid distribution
- **Smart expiration**: Automatic 7-day expiration for quick shares, "never" for configured shares
- **Streamlined workflow**: Reduces sharing time from 2 minutes to 30 seconds for common use cases
- **Contextual naming**: Automatically generates meaningful share names based on file content

### Enhanced Content Previews
- **Rich landing pages**: Modern card-based layout with image galleries and file categorization
- **Visual file grouping**: Separate sections for images, documents, videos, and other file types
- **Improved download experience**: Cleaner interface with better file organization and preview capabilities
- **Mobile optimization**: Touch-friendly interface that works seamlessly across all device sizes

### Automatic Upload System
- **Instant uploads**: Files upload immediately upon selection with real-time progress
- **Clipboard integration**: Paste images directly (Ctrl+V/Cmd+V) with automatic detection
- **Friendly URLs**: Download links include actual filenames for better user experience
- **Smart file serving**: Single files get direct links, multiple files are automatically zipped

## ⌨️ Setup

### Installation with Docker (recommended)

1. Download the `docker-compose.yml` file
2. Run `docker compose up -d`

The website is now listening on `http://localhost:3000`, have fun with GYTECH Cloud 🐧!

