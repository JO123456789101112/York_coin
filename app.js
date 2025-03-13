const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const port = process.env.PORT || 3000;

// 🔹 Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'image')));

// 🔹 إعداد الخادم
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 🔹 الاتصال بقاعدة البيانات
const mongoURI = process.env.MONGO_URI || "mongodb+srv://john:john@john.gevwwjw.mongodb.net/yorktelegramBot?retryWrites=true&w=majority&appName=john";
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// 🔹 تعريف النماذج
const userSchema = new mongoose.Schema({
  userIdentifier: { type: String, unique: true },
  name: String,
  counter: { type: Number, default: 0 },
  tasksCompleted: { type: Number, default: 0 },
  yorkBalance: { type: Number, default: 1 },
  lastAwardedCounter: { type: Number, default: 0 },
  ipAddress: String,
  gameEntry: {
    mode: { type: String, enum: ['free', 'paid'], default: 'free' },
    cost: { type: Number, default: 0 }
  },
  skin: { type: String, default: "/caracter.png" }
});
const User = mongoose.model("User", userSchema);

const WithdrawRequestSchema = new mongoose.Schema({
  userId: String,
  wallet: String,
  telegram: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});
const WithdrawRequest = mongoose.model("WithdrawRequest", WithdrawRequestSchema);

// 🔹 نقاط النهاية (Endpoints)
app.post("/withdraw", async (req, res) => {
  try {
    const { userId, wallet, telegram } = req.body;
    if (!userId || !wallet || !telegram) {
      return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
    }
    const newWithdrawRequest = new WithdrawRequest({ userId, wallet, telegram });
    await newWithdrawRequest.save();
    res.json({ success: true, message: "تم تقديم طلب السحب بنجاح" });
  } catch (error) {
    console.error("خطأ في تقديم طلب السحب", error);
    res.status(500).json({ success: false, message: "حدث خطأ داخلي" });
  }
});

app.post('/api/buy-skin', async (req, res) => {
  const { userIdentifier, amount, skin } = req.body;
  try {
    let user = await User.findOne({ userIdentifier });
    if (!user) return res.json({ success: false, message: "User not found" });
    if (user.yorkBalance < amount) return res.json({ success: false, message: "Insufficient York$" });

    user.yorkBalance -= amount;
    user.skin = skin;
    await user.save();
    res.json({ success: true, yorkBalance: user.yorkBalance, skin: user.skin });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Server error" });
  }
});

app.post('/api/update-game-coins', async (req, res) => {
  const { userIdentifier, coinIncrease } = req.body;
  try {
    let user = await User.findOneAndUpdate(
      { userIdentifier },
      { $inc: { yorkBalance: coinIncrease } },
      { new: true }
    );
    if (!user) return res.json({ success: false, message: "User not found" });
    res.json({ success: true, yorkBalance: user.yorkBalance });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Server error" });
  }
});

// 🔹 Socket.io لأحداث اللعبة
io.on('connection', (socket) => {
  console.log('لاعب متصل:', socket.id);

  socket.on('registerEntry', async (data) => {
    const { userIdentifier, entryMode, coinAmount } = data;
    try {
      let user = await User.findOne({ userIdentifier });
      if (!user) return console.log("User not found in game registration", userIdentifier);

      user.gameEntry = { mode: entryMode, cost: coinAmount };
      await user.save();
      socket.playerName = user.name;
      socket.userIdentifier = userIdentifier;
      console.log(`User ${userIdentifier} registered with entry mode ${entryMode}`);

      await Player.deleteMany({ userIdentifier });
    } catch (err) {
      console.error("Error in registerEntry:", err);
    }
  });

  socket.on('move', async (data) => {
    try {
      await Player.findOneAndUpdate({ socketId: socket.id }, { x: data.x, y: data.y });
      socket.broadcast.emit('playerMoved', { socketId: socket.id, x: data.x, y: data.y });
    } catch (err) {
      console.error("Error updating player position:", err);
    }
  });

  socket.on('playerKilled', async (data) => {
    const { killerId, victimId } = data;
    try {
      let victim = await User.findOne({ userIdentifier: victimId });
      let killer = await User.findOne({ userIdentifier: killerId });
      if (victim && killer && victim.gameEntry.mode === 'paid' && victim.gameEntry.cost > 0) {
        killer.yorkBalance += victim.gameEntry.cost;
        victim.gameEntry = { mode: 'free', cost: 0 };
        await victim.save();
        await killer.save();
        console.log(`Transferred ${victim.gameEntry.cost} York$ from ${victimId} to ${killerId}`);
      }
    } catch (err) {
      console.error("Error in playerKilled event:", err);
    }
  });

  socket.on('disconnect', async () => {
    console.log('انقطع الاتصال:', socket.id);
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (player) {
        await Stats.create({ socketId: player.socketId, kills: player.kills, deaths: player.deaths });
        await Player.deleteOne({ socketId: socket.id });
        io.emit('playerDisconnected', { socketId: socket.id });
      }
    } catch (err) {
      console.error(err);
    }
  });
});

// 🔹 تنظيف دوري للإحصائيات القديمة
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await Stats.deleteMany({ lastSeen: { $lt: cutoff } });
    console.log('تم حذف', result.deletedCount, 'سجل قديم من Stats');
  } catch (err) {
    console.error('خطأ أثناء تنظيف سجلات Stats:', err);
  }
}, 60 * 60 * 1000);

// 🔹 بدء الخادم
server.listen(port, () => {
  console.log(`الخادم يعمل على http://localhost:${port}`);
});
