# Deployment Guide - Digital Ocean Droplet

This guide will help you deploy your Next.js Fantasy Sports application to a Digital Ocean droplet.

## Prerequisites

### 1. What You Need:
- [ ] Digital Ocean droplet (Ubuntu 22.04 or later recommended)
- [ ] SSH access to your droplet (root or sudo user)
- [ ] Domain name pointing to your droplet IP (or use droplet IP directly)
- [ ] Your code pushed to a Git repository (GitHub, GitLab, etc.)
- [ ] Discord OAuth redirect URL updated to your production domain

### 2. Discord OAuth Setup:
1. Go to https://discord.com/developers/applications
2. Select your application
3. Navigate to OAuth2 settings
4. Add your production URL to redirect URLs:
   - `https://yourdomain.com/api/auth/callback/discord`
   - Or `http://your-droplet-ip:3000/api/auth/callback/discord` if using IP

---

## Step 1: Initial Server Setup

### SSH into your droplet:
```bash
ssh root@your-droplet-ip
```

### Update system packages:
```bash
apt update && apt upgrade -y
```

### Install required software:
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Install Git
apt install git -y

# Install Nginx (for reverse proxy)
apt install nginx -y

# Install Certbot (for SSL)
apt install certbot python3-certbot-nginx -y
```

---

## Step 2: Clone Your Repository

```bash
# Navigate to web directory
cd /var/www

# Clone your repository
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git fantasy-app
cd fantasy-app
```

---

## Step 3: Configure Environment Variables

Create a production `.env` file:

```bash
nano .env
```

Add the following (replace with your actual values):

```env
# NextAuth Secret
AUTH_SECRET=[]

# Your production URL
AUTH_URL=https://yourdomain.com

# Discord OAuth credentials
AUTH_DISCORD_ID=[INSERT]
AUTH_DISCORD_SECRET=[INSERT]

# Discord User IDs for admins
ADMIN_DISCORD_IDS=[ADMIN DISCORD ID]

# Digital Ocean PostgreSQL Database URL
DATABASE_URL=[URL]
```

**Important:** Update `AUTH_URL` to your actual domain!

Press `Ctrl+X`, then `Y`, then `Enter` to save.

---

## Step 4: Build and Run with Docker

### Option A: Using Docker Compose (Recommended)

```bash
# Build and start the container
docker-compose up -d --build

# View logs to confirm it's running
docker-compose logs -f
```

### Option B: Using Docker directly

```bash
# Build the image
docker build -t fantasy-sports-app .

# Run the container
docker run -d \
  --name fantasy-app \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  fantasy-sports-app

# View logs
docker logs fantasy-app -f
```

---

## Step 5: Configure Nginx Reverse Proxy

### Create Nginx configuration:

```bash
nano /etc/nginx/sites-available/fantasy-app
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeout for long-running requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Increase max upload size if needed
    client_max_body_size 10M;
}
```

**Replace `yourdomain.com` with your actual domain!**

### Enable the site:

```bash
# Create symbolic link
ln -s /etc/nginx/sites-available/fantasy-app /etc/nginx/sites-enabled/

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

---

## Step 6: Set Up SSL Certificate (HTTPS)

If using a domain name:

```bash
# Get SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow the prompts:
# - Enter your email
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: yes)
```

The certificate will auto-renew. Test renewal:
```bash
certbot renew --dry-run
```

---

## Step 7: Configure Firewall

```bash
# Allow SSH (important - don't lock yourself out!)
ufw allow 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable

# Check status
ufw status
```

---

## Step 8: Verify Deployment

1. **Visit your website:** https://yourdomain.com
2. **Test Discord login**
3. **Check database connectivity**

---

## Management Commands

### View Application Logs:
```bash
docker logs fantasy-app -f
```

### Restart Application:
```bash
docker restart fantasy-app
# Or with docker-compose:
docker-compose restart
```

### Update Application (Pull new changes):
```bash
cd /var/www/fantasy-app
git pull
docker-compose down
docker-compose up -d --build
```

### Stop Application:
```bash
docker stop fantasy-app
# Or with docker-compose:
docker-compose down
```

### View Running Containers:
```bash
docker ps
```

### Access Container Shell (for debugging):
```bash
docker exec -it fantasy-app sh
```

---

## Troubleshooting

### Application won't start:
```bash
# Check logs
docker logs fantasy-app

# Check if port 3000 is in use
netstat -tulpn | grep 3000

# Verify environment variables
docker exec fantasy-app env | grep AUTH
```

### Database connection issues:
```bash
# Test database connection from container
docker exec fantasy-app npx prisma db execute --stdin <<EOF
SELECT 1;
EOF
```

### Nginx issues:
```bash
# Check Nginx status
systemctl status nginx

# Test configuration
nginx -t

# View Nginx error logs
tail -f /var/log/nginx/error.log
```

### SSL Certificate issues:
```bash
# Check certificate status
certbot certificates

# Renew manually
certbot renew --force-renewal
```

---

## Performance Optimization (Optional)

### Enable Nginx caching:
Add to your Nginx config:
```nginx
location /_next/static {
    proxy_pass http://localhost:3000;
    proxy_cache_valid 200 60m;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Monitor container resources:
```bash
docker stats fantasy-app
```

---

## Backup Strategy

### Database Backup:
```bash
# Create backup script
nano /root/backup-db.sh
```

Add:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/backups"
mkdir -p $BACKUP_DIR

# Backup from Digital Ocean PostgreSQL
PGPASSWORD="PqS8WIl650bz8p5BdgIgBovfg9dd45h9" pg_dump \
  -h sprocketbot-postgres-d5033d2-do-user-24528890-0.j.db.ondigitalocean.com \
  -p 25060 \
  -U fantasy-rw \
  -d fantasy \
  > $BACKUP_DIR/fantasy_backup_$DATE.sql

# Keep only last 7 days of backups
find $BACKUP_DIR -name "fantasy_backup_*.sql" -mtime +7 -delete
```

Make executable and set up cron:
```bash
chmod +x /root/backup-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add line: 0 2 * * * /root/backup-db.sh
```

---

## Security Best Practices

1. **Keep packages updated:**
   ```bash
   apt update && apt upgrade -y
   ```

2. **Use SSH keys instead of passwords**

3. **Change default SSH port (optional)**

4. **Set up fail2ban:**
   ```bash
   apt install fail2ban -y
   systemctl enable fail2ban
   ```

5. **Regular backups** (see above)

6. **Monitor logs regularly**

---

## Support

For issues or questions:
- Check application logs: `docker logs fantasy-app -f`
- Check Nginx logs: `/var/log/nginx/error.log`
- Verify environment variables are set correctly
- Ensure Discord OAuth URLs match your domain
