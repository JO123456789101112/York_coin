const mongoose = require('mongoose');

const mongoURI = "mongodb+srv://john:john@john.gevwwjw.mongodb.net/yorktelegramBot?retryWrites=true&w=majority&appName=john";

let isConnected = false; // ✅ التحقق من الاتصال النشط

async function connectDB() {
  if (isConnected) {
    console.log("⚠️ MongoDB متصل مسبقًا");
    return;
  }

  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
    console.log("✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح");
  } catch (err) {
    console.error("❌ خطأ في الاتصال بقاعدة البيانات:", err);
  }
}

module.exports = connectDB;
