FROM node:20-alpine

# تثبيت mysql-client لتوفير أداة mysqldump الخاصة بالنسخ الاحتياطي لقاعدة البيانات
RUN apk add --no-cache mysql-client

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

# تشغيل سكربت التهيئة والتحقق من قاعدة البيانات أولاً ثم تشغيل السيرفر
CMD ["sh", "-c", "node scripts/db-init.js && npm start"]
