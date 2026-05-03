# FastPass - Parking & Visitor Management System

ระบบจัดการผู้มาติดต่อและที่จอดรถ (Visitor & Parking Management) CPE402

## 💻 Tech Stack
- **Frontend:** Angular, Ionic Framework, Tailwind CSS
- **Backend & Database:** Supabase (PostgreSQL, Edge Functions, Auth, Storage)

## ⚙️ Prerequisites
ก่อนรันโปรเจกต์ กรุณาติดตั้งเครื่องมือดังต่อไปนี้:
- Node.js (v18+)
- Ionic CLI (`npm install -g @ionic/cli`)
- Angular CLI (`npm install -g @angular/cli`)
- Supabase CLI (สำหรับรัน Local Backend หรือ Deploy Edge Functions)

## 🚀 How to Run (Local Development)



###  รัน Frontend

npm install
ionic serve


###  การจัดการ Supabase Edge Functions
โค้ด API พิเศษจะอยู่ในโฟลเดอร์ \`supabase/functions/\` (รันด้วย Deno)
- รันฟังก์ชันจำลองบนเครื่อง: \`supabase functions serve\`
- Deploy ฟังก์ชันขึ้นเซิร์ฟเวอร์: \`supabase functions deploy <function_name>\`

## 📚 Documentation
edgefunction จะอยู่ ที่ FassPass\supabase\functions
