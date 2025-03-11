const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const port = process.env.PORT || 3000;

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // يمكنك تغييره لاحقًا ليتناسب مع نطاقك
    methods: ["GET", "POST"]
  }
});

// الاتصال بقاعدة البيانات
const mongoURI = process.env.MONGO_URI || "mongodb+srv://john:john@john.gevwwjw.mongodb.net/yorktelegramBot?retryWrites=true&w=majority&appName=john";

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

/*-------------------
   تعريف النماذج
-------------------*/
// نموذج مستخدمين صفحة الدخول واللعبة
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
  }
});
const User = mongoose.model("User", userSchema);

// نموذج اللاعبين داخل اللعبة (Socket.io)
// تمت إضافة حقل userIdentifier لتتبع اللاعب نفسه وحقل name لتخزين الاسم
const PlayerSchema = new mongoose.Schema({
  socketId: String,
  userIdentifier: String,
  x: Number,
  y: Number,
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  name: { type: String, default: "Anonymous" }
});
const Player = mongoose.model('Player', PlayerSchema);

// نموذج الإحصائيات
const StatsSchema = new mongoose.Schema({
  socketId: String,
  kills: Number,
  deaths: Number,
  lastSeen: { type: Date, default: Date.now }
});
const Stats = mongoose.model('Stats', StatsSchema);

/*-------------------
   الإعدادات العامة
-------------------*/
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'image')));
app.use(express.json());

/*-------------------
   تعريف صفحات الويب
-------------------*/
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'games.html')));
app.get('/airdrop.html', (req, res) => res.sendFile(path.join(__dirname, 'airdrop.html')));
app.get('/task.html', (req, res) => res.sendFile(path.join(__dirname, 'task.html')));
app.get('/mystory.html', (req, res) => res.sendFile(path.join(__dirname, 'mystory.html')));

// صفحة اللعبة الرئيسية
app.get('/york_game_index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'york_game_index.html'));
});
app.get('/die.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'die.html'));
});

/*-------------------
   نقاط النهاية (Endpoints)
-------------------*/
// تسجيل دخول اللعبة (خصم العملة أو الدخول المجاني)
app.post('/api/join-game', async (req, res) => {
  const { userIdentifier, mode, coinAmount } = req.body;
  try {
    let user = await User.findOne({ userIdentifier });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }
    if (mode === "paid") {
      if (user.yorkBalance < coinAmount) {
        return res.json({ success: false, message: "Insufficient York$" });
      }
      user.yorkBalance -= coinAmount;
      user.gameEntry = { mode: "paid", cost: coinAmount };
      await user.save();
      return res.json({ success: true });
    } else if (mode === "free") {
      user.gameEntry = { mode: "free", cost: 0 };
      await user.save();
      return res.json({ success: true });
    } else {
      return res.json({ success: false, message: "Invalid mode" });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Server error" });
  }
});

// /increment لتحديث العداد وإضافة العملات عند تجاوز كل 1000 نقرة
app.post('/increment', async (req, res) => {
  const { userIdentifier, userName } = req.body;
  let user = await User.findOne({ userIdentifier });
  
  if (user) {
    user.counter++;
    let previousEarned = Math.floor(user.lastAwardedCounter / 1000);
    let currentEarned = Math.floor(user.counter / 1000);
    let newCoins = currentEarned - previousEarned;
    if (newCoins > 0) {
      user.yorkBalance += newCoins;
    }
    user.lastAwardedCounter = user.counter;
  } else {
    user = new User({ 
      userIdentifier, 
      name: userName, 
      counter: 1, 
      yorkBalance: 1,
      lastAwardedCounter: 0 
    });
  }

  await user.save();
  res.json({ userCounter: user.counter, yorkBalance: user.yorkBalance, userName: user.name });
});

app.post('/saveUserData', async (req, res) => {
  const { userIdentifier, userName } = req.body;
  const userIp = req.ip;

  let user = await User.findOne({ userIdentifier });

  if (user) {
    user.name = userName;
    user.ipAddress = userIp;
  } else {
    user = new User({ 
      userIdentifier, 
      name: userName, 
      counter: 0, 
      tasksCompleted: 0, 
      yorkBalance: 1,
      lastAwardedCounter: 0,
      ipAddress: userIp
    });
  }

  await user.save();
  res.json({ success: true });
});

app.get('/getUserData', async (req, res) => {
  const { userIdentifier } = req.query;
  let user = await User.findOne({ userIdentifier });

  if (user) {
    res.json({
      exists: true,
      userName: user.name,
      userCounter: user.counter,
      yorkBalance: user.yorkBalance,
      ipAddress: user.ipAddress
    });
  } else {
    res.json({ exists: false });
  }
});

app.post('/task-completed', async (req, res) => {
  const { userIdentifier } = req.body;
  let user = await User.findOne({ userIdentifier });

  if (user) {
    user.tasksCompleted++;
    await user.save();
    res.json({ tasksCompleted: user.tasksCompleted, userName: user.name });
  } else {
    res.json({ error: "User not found" });
  }
});

app.get('/database', async (req, res) => {
  try {
    const players = await Player.find({}).sort({ kills: -1 });
    res.json({ players });
  } catch(err) {
    console.error(err);
    res.json({ error: "Error fetching players" });
  }
});


/*-------------------
   Socket.io لأحداث اللعبة
-------------------*/
io.on('connection', (socket) => {
  console.log('لاعب متصل:', socket.id);

  // حدث تسجيل الدخول من صفحة york_game_index.html
  socket.on('registerEntry', async (data) => {
    const { userIdentifier, entryMode, coinAmount } = data;
    try {
      let user = await User.findOne({ userIdentifier });
      if (!user) {
        console.log("User not found in game registration", userIdentifier);
        return;
      }
      user.gameEntry = { mode: entryMode, cost: coinAmount };
      await user.save();
      // تخزين اسم اللاعب ومعرفه في الـ socket
      socket.playerName = user.name;
      socket.userIdentifier = userIdentifier;
      console.log(`User ${userIdentifier} registered with entry mode ${entryMode}`);
      // بعد التسجيل، قم بحذف أي وثائق سابقة لنفس اللاعب من مجموعة Player
      await Player.deleteMany({ userIdentifier: userIdentifier });
      console.log("Deleted old player documents for", userIdentifier);
    } catch(err) {
      console.error("Error in registerEntry:", err);
    }
  });

  // إرسال قائمة اللاعبين الحاليين للعميل الجديد
  Player.find({ socketId: { $ne: socket.id } })
    .then(existingPlayers => {
      socket.emit('existingPlayers', existingPlayers);
    })
    .catch(err => console.error(err));

  // إنشاء لاعب جديد بموقع عشوائي مع تخزين الاسم ومعرف المستخدم
  const randomX = Math.floor(Math.random() * 800);
  const randomY = Math.floor(Math.random() * 600);
  let newPlayer = new Player({ 
    socketId: socket.id, 
    userIdentifier: socket.userIdentifier || "unknown",
    x: randomX, 
    y: randomY,
    name: socket.playerName || "Anonymous"
  });
  newPlayer.save()
    .then(() => {
      socket.emit('init', { x: randomX, y: randomY });
      socket.broadcast.emit('newPlayer', { socketId: socket.id, x: randomX, y: randomY, name: socket.playerName || "Anonymous" });
    })
    .catch(err => console.error(err));

  socket.on('move', (data) => {
    Player.findOneAndUpdate({ socketId: socket.id }, { x: data.x, y: data.y }, { new: true })
      .then(() => {
        socket.broadcast.emit('playerMoved', { socketId: socket.id, x: data.x, y: data.y });
      })
      .catch(err => console.error(err));
  });

  socket.on('shoot', (data) => {
    socket.broadcast.emit('playerShot', { socketId: socket.id, x: data.x, y: data.y, angle: data.angle });
  });

  // حدث نقل العملات عند القتل
  socket.on('playerKilled', async (data) => {
    const { killerId, victimId } = data;
    try {
      let victim = await User.findOne({ userIdentifier: victimId });
      let killer = await User.findOne({ userIdentifier: killerId });
      if (victim && killer) {
        if (victim.gameEntry.mode === 'paid' && victim.gameEntry.cost > 0) {
          const amount = victim.gameEntry.cost;
          killer.yorkBalance += amount;
          victim.gameEntry = { mode: 'free', cost: 0 };
          await victim.save();
          await killer.save();
          console.log(`Transferred ${amount} York$ from ${victimId} to ${killerId}`);
        }
      }
    } catch (err) {
      console.error("Error in playerKilled event:", err);
    }
  });

  socket.on('disconnect', () => {
    console.log('انقطع الاتصال:', socket.id);
    Player.findOne({ socketId: socket.id })
      .then(player => {
        if (player) {
          const statsRecord = new Stats({
            socketId: player.socketId,
            kills: player.kills,
            deaths: player.deaths
          });
          return statsRecord.save()
            .then(() => Player.deleteOne({ socketId: socket.id }));
        }
      })
      .then(() => {
        io.emit('playerDisconnected', { socketId: socket.id });
      })
      .catch(err => console.error(err));
  });
});

/*-------------------
   تنظيف دوري للإحصائيات القديمة
-------------------*/
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  Stats.deleteMany({ lastSeen: { $lt: cutoff } })
    .then(result => {
      console.log('تم حذف', result.deletedCount, 'سجل قديم من Stats');
    })
    .catch(err => console.error('خطأ أثناء تنظيف سجلات Stats:', err));
}, 60 * 60 * 1000);

app.use('/whales_game_two', express.static(path.join(__dirname, 'whales_game_two')));

// نقطة نهاية لتحديث العملات المكتسبة في اللعبة
app.post('/api/update-game-coins', async (req, res) => {
  const { userIdentifier, coinIncrease } = req.body;
  try {
    let user = await User.findOne({ userIdentifier });
    if (!user) return res.json({ success: false, message: "User not found" });
    user.yorkBalance += coinIncrease;
    await user.save();
    res.json({ success: true, yorkBalance: user.yorkBalance });
  } catch(err) {
    console.error(err);
    res.json({ success: false, message: "Server error" });
  }
});

app.post('/api/deduct-coin', async (req, res) => {
  const { userIdentifier, amount } = req.body;
  try {
    let user = await User.findOne({ userIdentifier });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }
    if (user.yorkBalance < amount) {
      return res.json({ success: false, message: "Insufficient York$" });
    }
    user.yorkBalance -= amount;
    await user.save();
    res.json({ success: true, yorkBalance: user.yorkBalance });
  } catch(err) {
    console.error(err);
    res.json({ success: false, message: "Server error" });
  }
});

/*-------------------
   بدء الخادم
-------------------*/
server.listen(port, () => {
  console.log(`الخادم يعمل على http://localhost:${port}`);
});
