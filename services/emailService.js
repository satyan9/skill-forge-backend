const nodemailer = require('nodemailer');

/** Generate secure 6-digit OTP */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Build HTML email */
function buildOtpHtml(otp) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#040811;font-family:'Helvetica Neue',Arial,sans-serif}
  .wrap{max-width:460px;margin:40px auto;background:#0d0f1a;border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden}
  .header{background:linear-gradient(135deg,#6c63ff,#00d4aa);padding:30px;text-align:center}
  .logo-text{color:#fff;font-size:22px;font-weight:700}
  .body{padding:36px 40px}
  .msg{color:rgba(238,240,248,.6);font-size:14px;line-height:1.7;margin-bottom:28px}
  .otp-box{background:rgba(108,99,255,.12);border:2px solid rgba(108,99,255,.35);border-radius:14px;padding:24px;text-align:center;margin-bottom:24px}
  .otp-lbl{color:rgba(238,240,248,.4);font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}
  .otp-code{color:#9b94ff;font-size:42px;font-weight:800;letter-spacing:14px;font-family:'Courier New',monospace}
  .expiry{color:rgba(238,240,248,.4);font-size:12px;margin-top:10px}
  .footer{padding:18px 40px;border-top:1px solid rgba(255,255,255,.06);color:rgba(238,240,248,.25);font-size:12px;text-align:center}
</style>
</head>
<body>
  <div class="wrap">
    <div class="header"><div class="logo-text">⚡ SkillForge AI</div></div>
    <div class="body">
      <div class="msg">Use the code below to verify your email and complete your registration.</div>
      <div class="otp-box">
        <div class="otp-lbl">Verification Code</div>
        <div class="otp-code">${otp}</div>
        <div class="expiry">⏱ Expires in 5 minutes</div>
      </div>
      <div style="color:#ff9999;font-size:13px">🔒 Never share this code with anyone.</div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} SkillForge AI</div>
  </div>
</body></html>`;
}

const LINE = '─'.repeat(55);

/**
 * Send OTP via Gmail SMTP using Nodemailer.
 */
async function sendOtpEmail(toEmail, otp) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  // ── Check configured ──
  if (!emailUser || !emailPass) {
    // Fallback: print to console so dev flow still works
    console.log(`\n${LINE}`);
    console.log('  ⚠️  EMAIL_USER and EMAIL_PASS not set in .env — printing OTP to console');
    console.log(`  To   : ${toEmail}`);
    console.log(`  Code : \x1b[33m${otp}\x1b[0m`);
    console.log(`${LINE}\n`);
    return { devMode: true };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  console.log(`\n${LINE}`);
  console.log(`  📤  Sending OTP via Gmail`);
  console.log(`  Delivering to   : ${toEmail}`);

  try {
    const info = await transporter.sendMail({
      from: `"SkillForge AI" <${emailUser}>`,
      to: toEmail,
      subject: 'Your SkillForge AI verification code',
      html: buildOtpHtml(otp),
    });

    console.log(`  ✅  OTP email sent successfully!`);
    console.log(`  📬  Message ID: ${info.messageId}`);
    console.log(`${LINE}\n`);
    return info;
  } catch (error) {
    console.log(`  ❌  Nodemailer error: ${error.message}`);
    console.log(`${LINE}\n`);
    throw new Error(error.message);
  }
}

module.exports = { generateOtp, sendOtpEmail };
