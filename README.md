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
- **Enhanced file management** - Visual file thumbnails and icons in "My Shares"
- **File type recognition** - Colored icons for images, videos, audio, documents, and archives
- **Real image previews** - 40px thumbnails for uploaded images
- **Streamlined interface** - No manual "Share" button required, instant uploads

### Authentication & Security  
- OIDC and LDAP authentication
- Integration with ClamAV for security scans
- Password protection and visitor limits

### Storage Options
- Different file providers: local storage and S3
- Configurable upload settings and file handling

## 🐧 Get to know GYTECH Cloud

## 🚀 Recent Improvements

### Automatic Upload System
- **One-click sharing**: Select files and they upload automatically with default settings
- **No more modal dialogs**: Streamlined workflow removes the need for manual confirmation
- **Instant feedback**: Real-time upload progress and completion notifications

### Enhanced Download Experience  
- **Friendly URLs**: Download links now include actual filenames for better user experience
- **Smart file serving**: Single files get direct download links, multiple files are automatically zipped
- **SEO-friendly**: URLs are readable and include file extensions

### Visual File Management
- **Thumbnail previews**: Real image thumbnails (40px) in the "My Shares" section
- **File type icons**: Color-coded icons for easy file type identification:
  - 🖼️ **Green** for images (jpg, png, gif, etc.)
  - 🎬 **Red** for videos (mp4, avi, mov, etc.)
  - 🎵 **Purple** for audio (mp3, wav, flac, etc.)
  - 📦 **Orange** for archives (zip, rar, 7z, etc.)
  - 📄 **Blue** for documents (txt, md, rtf, etc.)
  - 📁 **Gray** for other file types
- **Improved table layout**: Removed clutter, focus on file names and visual identification

## ⌨️ Setup

### Installation with Docker (recommended)

1. Download the `docker-compose.yml` file
2. Run `docker compose up -d`

The website is now listening on `http://localhost:3000`, have fun with GYTECH Cloud 🐧!

