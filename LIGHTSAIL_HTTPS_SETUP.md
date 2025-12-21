# HTTPS Setup for AWS Lightsail (Caddy Method)

## Prerequisites
- AWS Lightsail instance running Node.js app
- Domain name pointed to your Lightsail instance IP
- SSH access to your instance

---

## Step 1: Prepare Your Lightsail Instance

### 1.1 Open Firewall Ports
In **Lightsail Console** → Your Instance → **Networking** tab:
- ✅ Port 80 (HTTP) - should already be open
- ✅ Port 443 (HTTPS) - **Add this if not present**
- ✅ Port 3000 (Node.js) - can be removed after Caddy is working

### 1.2 SSH into Your Instance
```bash
ssh -i /path/to/your-key.pem ubuntu@your-lightsail-ip
# OR use Lightsail browser-based SSH
```

---

## Step 2: Install Caddy

```bash
# Update system
sudo apt update

# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Verify installation
caddy version
```

---

## Step 3: Upload and Configure Caddyfile

### 3.1 Upload Caddyfile to Server
From your **local machine** (in project directory):
```bash
# Replace with your actual Lightsail IP and key path
scp -i /path/to/your-key.pem Caddyfile ubuntu@your-lightsail-ip:~/
```

### 3.2 Edit Caddyfile with Your Domain
On the **Lightsail instance**:
```bash
nano ~/Caddyfile
```

**Replace** `your-domain.com` with your actual domain (e.g., `clinova-rx.com`):
```caddy
clinova-rx.com {
    reverse_proxy localhost:3000
    
    tls {
        protocols tls1.2 tls1.3
    }
    
    header {
        -Server
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
    
    log {
        output file /var/log/caddy/clinova-rx.log
        format json
    }
}
```

Save and exit (`Ctrl+X`, then `Y`, then `Enter`)

### 3.3 Move Caddyfile to System Location
```bash
sudo mkdir -p /var/log/caddy
sudo cp ~/Caddyfile /etc/caddy/Caddyfile
sudo chown caddy:caddy /var/log/caddy
```

---

## Step 4: Ensure Node.js App is Running

```bash
# Check if your app is running on port 3000
curl http://localhost:3000

# If not running, start it (adjust command as needed)
cd /path/to/your/app
NODE_ENV=production npm start &

# OR if using PM2:
pm2 start src/server.js --name clinova-rx
pm2 save
```

---

## Step 5: Start Caddy

```bash
# Enable Caddy to start on boot
sudo systemctl enable caddy

# Start Caddy
sudo systemctl start caddy

# Check status
sudo systemctl status caddy
```

**Expected output:** `Active: active (running)`

---

## Step 6: Verify HTTPS is Working

### 6.1 Test HTTP Redirect
```bash
curl -I http://your-domain.com
# Should return: HTTP/1.1 308 Permanent Redirect
# Location: https://your-domain.com
```

### 6.2 Test HTTPS
```bash
curl -I https://your-domain.com
# Should return: HTTP/2 200
# Should include: strict-transport-security: max-age=31536000
```

### 6.3 Test in Browser
Visit `https://your-domain.com` - should show:
- 🔒 Lock icon in address bar
- Valid SSL certificate
- Your app working normally

---

## Step 7: Update Environment (Optional)

If you have a `.env` file:
```bash
cd /path/to/your/app
echo "NODE_ENV=production" >> .env

# Restart app to pick up changes
pm2 restart clinova-rx
# OR if running directly:
# pkill node && NODE_ENV=production npm start &
```

---

## Troubleshooting

### Caddy Won't Start
```bash
# Check logs
sudo journalctl -u caddy -n 50 --no-pager

# Common issues:
# - Port 80/443 already in use
sudo lsof -i :80
sudo lsof -i :443

# - Syntax error in Caddyfile
caddy validate --config /etc/caddy/Caddyfile
```

### SSL Certificate Not Issued
```bash
# Check Caddy logs
sudo journalctl -u caddy -f

# Verify DNS is pointing to your Lightsail IP
dig your-domain.com

# Ensure ports 80 and 443 are open in Lightsail firewall
```

### App Not Accessible
```bash
# Verify Node.js is running
curl http://localhost:3000

# Check Caddy is proxying correctly
sudo journalctl -u caddy -f
# Then visit your site and watch logs
```

---

## Maintenance

### View Logs
```bash
# Caddy logs
sudo journalctl -u caddy -f

# App logs (if using PM2)
pm2 logs clinova-rx

# Caddy access logs
sudo tail -f /var/log/caddy/clinova-rx.log
```

### Restart Caddy
```bash
sudo systemctl restart caddy
```

### Update Caddyfile
```bash
sudo nano /etc/caddy/Caddyfile
# Make changes
sudo systemctl reload caddy  # Reload without downtime
```

### Check Certificate Expiry
```bash
# Caddy auto-renews, but you can check:
sudo caddy list-certificates
```

---

## Security: Close Port 3000

Once HTTPS is working, **block direct access** to port 3000:

In **Lightsail Console** → Your Instance → **Networking** → **Firewall**:
- ❌ **Remove** port 3000 rule

This forces all traffic through Caddy (HTTPS only).

---

## Rollback (If Needed)

```bash
# Stop Caddy
sudo systemctl stop caddy

# Re-open port 3000 in Lightsail console

# Access app directly
http://your-lightsail-ip:3000
```

---

## Estimated Time
- **Setup:** 15-20 minutes
- **Testing:** 5 minutes
- **Total:** ~25 minutes

---

## Next Steps After Setup

1. ✅ Test all app features (login, transcription, printing)
2. ✅ Verify WebSocket connections work (live transcription)
3. ✅ Check SSL Labs rating: https://www.ssllabs.com/ssltest/
4. ✅ Monitor logs for first 24 hours
5. ✅ Set up monitoring (optional): UptimeRobot, Pingdom, etc.

---

## Support

If you encounter issues:
1. Check Caddy logs: `sudo journalctl -u caddy -f`
2. Verify DNS: `dig your-domain.com`
3. Test Node.js directly: `curl http://localhost:3000`
4. Ensure Lightsail firewall allows ports 80 and 443
