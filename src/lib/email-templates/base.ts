interface EmailTemplateProps {
  title: string
  preheader: string
  content: string
  ctaText?: string
  ctaUrl?: string
}

export function getAppUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3001'
  ).replace(/\/+$/, '')
}

export function getEmailTemplate({
  title,
  preheader,
  content,
  ctaText,
  ctaUrl,
}: EmailTemplateProps): string {
  const appUrl = getAppUrl()
  
  return `
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;600&display=swap');
    
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background-color: #18181b;
    }
    
    .preheader {
      display: none;
      max-height: 0;
      max-width: 0;
      opacity: 0;
      overflow: hidden;
    }
    
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    
    .email-wrapper {
      background-color: #000000;
      padding: 40px 20px;
    }
    
    .content-card {
      background: #ffffff;
      border-radius: 16px;
      padding: 40px;
      border: 1px solid #e4e4e7;
    }
    
    .logo-container {
      text-align: center;
      margin-bottom: 32px;
    }
    
    .logo {
      width: 48px;
      height: 48px;
    }
    
    .brand-name {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: #000000;
      margin-top: 12px;
    }
    
    h1 {
      font-family: 'Outfit', sans-serif;
      color: #000000;
      font-size: 28px;
      font-weight: 600;
      margin: 0 0 16px 0;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    
    p {
      color: #52525b;
      font-size: 16px;
      font-weight: 300;
      line-height: 1.6;
      margin: 0 0 16px 0;
    }
    
    strong {
      font-weight: 500;
      color: #18181b;
    }
    
    .cta-button {
      display: inline-block;
      background: #000000;
      color: #ffffff !important;
      text-decoration: none;
      padding: 16px 48px;
      border-radius: 12px;
      font-weight: 500;
      font-size: 16px;
      margin: 24px 0;
      transition: all 0.3s ease;
    }
    
    .cta-button:hover {
      background: #27272a;
    }
    
    .divider {
      border: none;
      border-top: 1px solid #e4e4e7;
      margin: 32px 0;
    }
    
    .footer {
      text-align: center;
      padding: 32px 20px;
      color: #71717a;
      font-size: 14px;
      font-weight: 300;
    }
    
    .footer a {
      color: #bfdbfe;
      text-decoration: none;
    }
    
    .footer a:hover {
      text-decoration: underline;
    }
    
    .security-notice {
      background: #fafafa;
      border-left: 3px solid #bfdbfe;
      padding: 16px;
      border-radius: 8px;
      margin: 24px 0;
    }
    
    .security-notice p {
      margin: 0;
      font-size: 14px;
      color: #3f3f46;
      font-weight: 300;
    }
    
    .accent-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      background: #bfdbfe;
      border-radius: 50%;
      margin: 0 4px;
    }
    
    ul {
      color: #52525b;
      font-size: 16px;
      font-weight: 300;
      line-height: 1.6;
      padding-left: 24px;
    }
    
    ul li {
      margin-bottom: 8px;
    }
    
    @media only screen and (max-width: 600px) {
      .content-card {
        padding: 24px !important;
        border-radius: 12px !important;
      }
      
      h1 {
        font-size: 24px !important;
      }
      
      .cta-button {
        display: block;
        text-align: center;
        padding: 14px 32px !important;
      }
      
      .email-wrapper {
        padding: 20px 12px !important;
      }
    }
  </style>
</head>
<body>
  <!-- Preheader text -->
  <div class="preheader">${preheader}</div>
  
  <!-- Main wrapper -->
  <div class="email-wrapper">
    <div class="container">
      <div class="content-card">
        <!-- Logo & Brand -->
        <div class="logo-container">
          <img src="${appUrl}/bordclear.png" alt="BORDS" class="logo" />
          <div class="brand-name">BORDS</div>
        </div>
        
        <!-- Content -->
        <h1>${title}</h1>
        ${content}
        
        ${ctaText && ctaUrl ? `
        <!-- CTA Button -->
        <div style="text-align: center;">
          <a href="${ctaUrl}" class="cta-button">${ctaText}</a>
        </div>
        ` : ''}
        
        <!-- Divider -->
        <hr class="divider" />
        
        <!-- Footer info -->
        <p style="font-size: 14px; color: #71717a;">
          If you didn't request this email, you can safely ignore it.
        </p>
      </div>
      
      <!-- Email footer -->
      <div class="footer">
        <p style="margin-bottom: 8px;">
          <span class="accent-dot"></span>
          <span class="accent-dot"></span>
          <span class="accent-dot"></span>
        </p>
        <p style="color: #a1a1aa; margin-bottom: 16px;">
          © ${new Date().getFullYear()} BORDS by AXECORE Labs Inc. All rights reserved.
        </p>
        <p>
          <a href="${appUrl}">Website</a>
          <span style="color: #52525b; margin: 0 8px;">·</span>
          <a href="${appUrl}/support">Support</a>
          <span style="color: #52525b; margin: 0 8px;">·</span>
          <a href="${appUrl}/privacy">Privacy</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim()
}
