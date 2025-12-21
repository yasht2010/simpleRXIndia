# HTTPS/SSL Deployment Guide

## Quick Start (Caddy - Recommended)

### 1. Install Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. Configure Caddy
```bash
# Copy Caddyfile to system location
sudo cp Caddyfile /etc/caddy/Caddyfile

# Edit and replace 'your-domain.com' with your actual domain
sudo nano /etc/caddy/Caddyfile
```

### 3. Update Environment
```bash
# Ensure NODE_ENV is set to production in .env
echo "NODE_ENV=production" >> .env
```

### 4. Start Services
```bash
# Start Node.js app
npm start

# Start Caddy (in another terminal or as service)
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 5. Verify HTTPS
```bash
# Check if HTTPS redirect works
curl -I http://your-domain.com

# Check HSTS header
curl -I https://your-domain.com | grep -i strict
```

---

## Alternative: Nginx Setup

### 1. Install Nginx and Certbot
```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
```

### 2. Configure Nginx
```bash
# Copy config
sudo cp nginx.conf /etc/nginx/sites-available/clinova-rx

# Update domain name
sudo nano /etc/nginx/sites-available/clinova-rx

# Enable site
sudo ln -s /etc/nginx/sites-available/clinova-rx /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t
```

### 3. Obtain SSL Certificate
```bash
sudo certbot --nginx -d your-domain.com
```

### 4. Enable Auto-Renewal
```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### 5. Start Nginx
```bash
sudo systemctl restart nginx
```

---

## Firewall Configuration

```bash
# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Block direct access to Node.js port
sudo ufw deny 3000/tcp

# Enable firewall
sudo ufw enable
```

---

## Testing Checklist

- [ ] HTTP redirects to HTTPS: `curl -I http://your-domain.com`
- [ ] HSTS header present: `curl -I https://your-domain.com | grep Strict`
- [ ] SSL certificate valid: Visit `https://your-domain.com` in browser
- [ ] WebSocket works: Test live transcription feature
- [ ] Session cookies have Secure flag: Check in browser DevTools
- [ ] SSL Labs test: https://www.ssllabs.com/ssltest/
- [ ] Security Headers test: https://securityheaders.com/

---

## Troubleshooting

### Caddy won't start
```bash
# Check logs
sudo journalctl -u caddy -f

# Verify port 80/443 not in use
sudo lsof -i :80
sudo lsof -i :443
```

### Certificate issues
```bash
# Caddy: Check certificate status
sudo caddy list-certificates

# Nginx: Renew manually
sudo certbot renew --dry-run
```

### WebSocket connection fails
- Verify proxy_set_header Upgrade is configured
- Check browser console for WebSocket errors
- Ensure Socket.IO client connects to HTTPS URL

---

## Monitoring

### Certificate Expiry
```bash
# Caddy: Auto-renewal is automatic
# Nginx: Check renewal timer
sudo systemctl status certbot.timer
```

### Logs
```bash
# Caddy
sudo journalctl -u caddy -f

# Nginx
sudo tail -f /var/log/nginx/clinova-rx-access.log
sudo tail -f /var/log/nginx/clinova-rx-error.log

# Node.js app
# (Check your process manager logs - PM2, systemd, etc.)
```

---

## Rollback

If you need to temporarily disable HTTPS:

```bash
# Caddy
sudo systemctl stop caddy

# Nginx
sudo systemctl stop nginx

# Access app directly (for debugging only)
http://your-server-ip:3000
```

**Remember to re-enable HTTPS before allowing production traffic!**
