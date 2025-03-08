# استخدم صورة Node.js
FROM node:18

# تعيين مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات المشروع
COPY package.json package-lock.json ./

# تثبيت الحزم فقط للإنتاج
RUN npm install --production

# نسخ بقية ملفات المشروع
COPY . .

# فتح البورت 3000
EXPOSE 3000

# تشغيل التطبيق
CMD ["node", "app.js"]