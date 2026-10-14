// Offline mind: intent matching with varied, personality-flavoured lines.
// Used when Claude is not available, and as the fallback for any failed call.
//
// An intent: { id, priority, test(ctx) -> boolean|number, reply(ctx) -> Reply|string }
// Reply: { text, emo?, act?, aff?, mem?, sug?, plain? }  (plain: no style flavouring)

import { pickFresh, pick, capitalize } from './util.js';

export const STYLES = {
  sweet: { label: 'Sweet', desc: 'Warm, gentle, cheers you on.', sample: "You came back! I saved you the comfy spot." },
  playful: { label: 'Playful', desc: 'Teasing, quick, a little mischievous.', sample: "Oh, it's you. I was just about to win an argument with my cat." },
  tsundere: { label: 'Tsundere', desc: 'Prickly on the outside, soft underneath.', sample: "I-it's not like I was waiting for you. The tea just happened to be ready." },
  chill: { label: 'Chill', desc: 'Laid-back, dry humour, easy company.', sample: "Hey. Lamp's on, music's low. Pull up a cushion." },
  goth: { label: 'Dramatic goth', desc: 'Moody, theatrical, secretly a softie.', sample: "Ah, a visitor beneath the moon. How deliciously ominous." },
};

// Facts both minds share.
export const BIO = {
  cafe: 'Lantern Café',
  cat: 'Mochi',
  constellation: 'Lyra',
  movie: 'The Moon Ferry',
  food: 'omurice',
};

const GREET = {
  morning: {
    sweet: ['Good morning, {p}! Did you sleep okay?', 'Morning, {p}. I just made tea. Want to keep me company?'],
    playful: ["Morning, sleepyhead. You've got pillow face, {p}.", 'Rise and shine, {p}! I already beat Mochi at staring contests twice.'],
    tsundere: ["Oh. Morning. I wasn't up early waiting or anything, {p}.", "You're up. Good. ...I mean, whatever, morning."],
    chill: ['Morning, {p}. Slow start? Same.', 'Hey. Coffee first, then words.'],
    goth: ['The cursed sun has risen, {p}. At least you are here.', 'Morning. I mourn the night, but I welcome you.'],
  },
  afternoon: {
    sweet: ['Hi, {p}! How is your afternoon going?', 'Hey {p}! Perfect timing, I just finished my sketch.'],
    playful: ['Afternoon, {p}! Here to distract me from homework? Excellent.', "Look who it is. I was hoping you'd show up, {p}."],
    tsundere: ["Oh, it's you. Fine, I have a minute. Maybe two.", "Hmph. Took you long enough, {p}. Hi."],
    chill: ['Hey {p}. Afternoon slump hitting yet?', 'Yo. Mochi says hi. Well, Mochi is asleep. I say hi.'],
    goth: ['The afternoon drags like a funeral march, {p}. Save me.', 'Ah, {p}. The daylight is unbearable, but you are not.'],
  },
  evening: {
    sweet: ['Good evening, {p}! I turned the fairy lights on for you.', 'Hi {p}! How was your day? Tell me everything.'],
    playful: ["Evening, {p}! Shift's over, so I'm all yours. Lucky you.", 'Hey you. I smell like coffee beans and victory.'],
    tsundere: ['Evening. I left the lamp on. For reading! Not for you.', "You're here. Good. I mean, okay. Hi, {p}."],
    chill: ['Evening, {p}. Fairy lights on, kettle on. Life is good.', 'Hey. Long day? Sit, breathe.'],
    goth: ['Dusk falls, and so do you into my room, {p}. Welcome.', 'The city lights awaken. So do I. Hello, {p}.'],
  },
  night: {
    sweet: ["Hey {p}, it's late! I'm happy to see you, but don't stay up too long, okay?", 'Hi {p}. The moon is so pretty tonight. Come look.'],
    playful: ["A night owl, huh {p}? Same. Let's be bad at sleeping together.", 'Psst. {p}. The stars are out and so am I.'],
    tsundere: ["It's late, you know. ...Since you're here anyway, hi.", "You should be asleep. But fine, five minutes, {p}."],
    chill: ['Late-night crew. Nice. Hey {p}.', "Hey {p}. Quiet night. Good night for talking."],
    goth: ['The night is ours, {p}. Finally, the good hours.', 'Ah, the witching hour. My favourite time, my favourite visitor.'],
  },
};

const FALLBACK = {
  sweet: ['Mm, I like hearing you talk about that. What happened next?', "That's really interesting, {p}. How did it make you feel?", 'Tell me more? I want to understand.', 'I love these little chats with you.'],
  playful: ['Okay, I need the full story now. No skipping.', "Hmm, suspicious. Continue, I'm listening.", 'Ha, you always say the most unexpected things, {p}.', 'Plot twist. Go on, go on.'],
  tsundere: ["Hmph. That's... actually kind of interesting. Keep going.", "I'm only listening because I have nothing better to do. So, then what?", "Fine, you have my attention. Don't let it go to your head."],
  chill: ['Huh. Yeah, I get that.', 'Mm. Say more?', 'Fair. What else is on your mind?', "Nice. I like how you think about stuff."],
  goth: ['How wonderfully strange. Tell me more, {p}.', 'Ah, the plot thickens like midnight fog.', 'Speak on. The night is long and I am curious.'],
  any: ["Ooh. Okay, I'm curious now.", "Wait, really? Tell me more.", 'Hmm, I never thought about it like that.', "You know, I was thinking something similar the other day."],
};

const QUESTIONS = [
  { key: 'favorite food', q: "What's your favourite food? I'm always hunting for new recipes." },
  { key: 'hobby', q: 'What do you do for fun when you are not here?' },
  { key: 'favorite movie', q: "What's a movie you could watch over and over?" },
  { key: 'first game', q: "What's the first video game you ever loved?" },
  { key: 'pets', q: 'Do you have any pets? Mochi demands to know.' },
  { key: 'dream place', q: 'If you could live anywhere for a year, where would it be?' },
  { key: 'music', q: 'What do you listen to when you are winding down?' },
  { key: 'best part of today', q: 'What was the best part of your day?' },
  { key: 'job or school', q: 'What do you do, by the way? Work, school, something else?' },
  { key: 'favorite season', q: "What's your favourite season?" },
  { key: 'comfort drink', q: 'Tea, coffee, or hot chocolate person?' },
];

const JOKES = [
  "Why did the cat sit on the computer? To keep an eye on the mouse.",
  "I told my sketchbook a joke. It drew a blank.",
  "What do you call a sleepy star? A little dim. Ha. Sorry.",
  "Why don't eggs tell jokes? They'd crack each other up. I make omurice, I'm allowed.",
  "I asked the barista for a latte with a pun in it. She said that's a brew-tiful idea. The barista was me.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
];

const TOPICS = [
  { id: 'stars', re: /\b(stars?|moon|constellations?|sky|planets?|telescope|space|galaxy|astronom|meteor|shooting star)\b/,
    lines: ["Did you know Vega in {const} is one of the brightest stars up there? I find it every clear night.", 'My telescope is tiny, but on a good night I can see Saturn\'s rings. I squeaked the first time.', 'The moon looks extra soft tonight. I want to sketch it.'],
    emo: 'excited', sug: 'go:rooftop' },
  { id: 'games', re: /\b(games?|gaming|nintendo|playstation|xbox|switch|pixel|arcade|retro|mario|zelda|tetris|pokemon|console|cartridge)\b/,
    lines: ['I have a little CRT and an old console by the wall. Falling-block puzzles are my weakness. And my strength.', 'Retro games just feel cosy, you know? Chunky pixels, cheerful music.', 'Want to play something with me? I warn you, I get competitive.'],
    emo: 'excited', sug: 'play:rps' },
  { id: 'cats', re: /\b(cats?|kitten|kitty|meow|mochi|purr)\b/,
    lines: ["Mochi is asleep on my bed again. She's an orange loaf with opinions.", 'Cats are perfect. Soft, judgemental, warm. Ideal roommates.', 'Mochi once stole a whole croissant from my plate and walked away like nothing happened.'],
    emo: 'happy' },
  { id: 'food', re: /\b(cook|cooking|recipe|food|eat|eating|dinner|lunch|breakfast|bake|baking|hungry|snack|curry|omurice|ramen|pizza)\b/,
    lines: ["I make a mean {food}. The trick is to keep the egg a little soft.", 'Weekend plan: bake melon pan and eat half of it before it cools. Again.', 'Have you eaten today? Real food, not just snacks?'],
    emo: 'happy' },
  { id: 'movies', re: /\b(movies?|films?|cinema|watch|netflix|show|series|classic|black and white|musical)\b/,
    lines: ['I love old movies. {movie}, from 1952, is my all-time favourite. The poster is on my wall!', 'Black-and-white films have this glow, like everyone is lit by moonlight.', 'We should have a movie night sometime. I will make popcorn.'],
    emo: 'relaxed' },
  { id: 'art', re: /\b(draw|drawing|art|artist|illustrat\w*|sketch\w*|paint\w*|doodle)\b/,
    lines: ["I'm studying illustration. Right now I'm drawing Mochi, but she keeps moving.", 'My sketchbook is mostly cats, cafés and the moon. Very on-brand.', 'Drawing calms me down. Do you make anything? Art, music, food, anything?'],
    emo: 'happy' },
  { id: 'cafe', re: /\b(coffee|caf[eé]|latte|espresso|barista|tea|work|job|shift)\b/,
    lines: ['I work part-time at the {cafe}. Today I made a latte-art cat that looked like a potato.', 'Regulars at the café are the best. One old man orders cocoa and tells me about his garden.', "Café shifts are tiring, but the smell of coffee beans makes up for it."],
    emo: 'happy' },
  { id: 'music', re: /\b(music|songs?|listen\w*|bands?|sing\w*|playlist|lofi|lo-fi|jazz|piano)\b/,
    lines: ['I always have something soft playing at night. Lo-fi, old jazz, rain sounds.', 'Do you have a song you play when you are sad? Mine is an old piano piece.', 'If I could play any instrument, it would be piano.'],
    emo: 'relaxed' },
  { id: 'school', re: /\b(school|study|studying|exams?|class|homework|uni|university|college|test|assignment|deadline)\b/,
    lines: ['Deadlines are the worst. Want to do a little focus session and then take a break?', 'You are working hard, I can tell. Remember to drink water.', 'I have a portfolio review soon. We can be stressed together.'],
    emo: 'relaxed' },
  { id: 'weather', re: /\b(rain\w*|weather|snow\w*|sunny|cold|hot|storm|cloud\w*|wind\w*)\b/,
    lines: ['Rainy nights are my favourite. Tea, blanket, sketchbook.', 'If it is cold where you are, go grab a blanket. Doctor Mira says so.', 'The sky has been so moody lately. I love it.'],
    emo: 'relaxed' },
];

// ---------------------------------------------------------------------------

export function createOffline(app) {
  const extra = []; // intents registered by modules

  const fill = (s, ctx) => String(s)
    .replace(/\{p\}/g, ctx.player || 'friend')
    .replace(/\{me\}/g, ctx.her)
    .replace(/\{cafe\}/g, BIO.cafe)
    .replace(/\{const\}/g, BIO.constellation)
    .replace(/\{movie\}/g, BIO.movie)
    .replace(/\{food\}/g, BIO.food);

  const byStyle = (ctx, key, pools) => fill(pickFresh(key + ':' + ctx.style, pools[ctx.style] || pools.any || Object.values(pools)[0]), ctx);

  function flavor(text, ctx, id) {
    if (Math.random() > 0.22) return text;
    const f = {
      playful: [(t) => t + ' Just saying.', (t) => 'Heh. ' + t],
      tsundere: [(t) => 'Hmph. ' + t, (t) => t + " ...Don't read into it."],
      chill: [(t) => 'Mm. ' + t],
      goth: [(t) => t + ' How poetic.', (t) => 'Ah. ' + t],
      sweet: [(t) => t],
    }[ctx.style];
    return f && !/^(greet|bye)/.test(id) ? pick(f)(text) : text;
  }

  const level = (ctx) => ctx.level;

  const INTENTS = [
    // Safety first.
    { id: 'crisis', priority: 100, test: (c) => /\b(kill (myself|me)|suicid\w*|end (it all|my life)|want to die|wanna die|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself|no reason to live|don'?t want to (live|be alive|be here)|better off dead)\b/.test(c.lower),
      reply: (c) => ({ plain: true, emo: 'sad', act: null, aff: 0, crisis: true,
        text: `${c.player ? c.player + ', ' : ''}I'm really glad you told me, and I care about what happens to you. Please reach out to someone you trust right now, or contact your local emergency number or a crisis line. If you're in the US you can call or text 988. I'll stay right here with you while you do.` }) },
    { id: 'nsfw', priority: 90, test: (c) => /\b(sex\w*|nude\w*|naked|strip\w*|boobs?|breasts?|lingerie|underwear|panties|bra\b|bikini|swimsuit|horny|nsfw|lewd|undress\w*|take (it|that|your clothes) off|make out|kiss (me )?on the lips|sleep with me|in bed with|touch (you|your) (body|chest|butt|thighs?)|turn me on|sexy)\b/.test(c.lower),
      reply: (c) => ({ plain: true, emo: 'shy', act: 'shake', aff: 0, sug: 'play:rps',
        text: byStyle(c, 'nsfw', {
          sweet: ["Hey, let's keep things cosy and PG, okay? I like you, and I like how we hang out. Want to hear what Mochi did today?", "That's not something I'll do, but I'm still happy you're here. Let's talk about something else. How was your day, really?"],
          playful: ["Nope, not that kind of game! Keep it PG, you goof. How about rock-paper-scissors instead?", "Ha, nice try. Not happening. I will, however, destroy you at a card game."],
          tsundere: ["W-what?! No. Absolutely not. We're keeping this PG. ...Ask me something normal.", "Hmph. Not that. Pick a different topic before I throw a cushion at you."],
          chill: ["Gonna pass on that one. Let's keep it PG. Tell me about your week instead?", "Nah, not my thing. Let's keep it wholesome. What are you up to tonight?"],
          goth: ["Even the darkness has boundaries, and that's one of mine. Keep it PG, darling. Shall we talk about the stars?", "No. Let us speak of nobler things. Haunted castles, perhaps?"],
        }) }) },
    { id: 'ai', priority: 80, test: (c) => /\b(are you|r u|you'?re|you are) (a |an )?(real|human|ai|a\.i\.|bot|robot|alive|person|program|chatbot|computer)\b|\bare you real\b/.test(c.lower),
      reply: (c) => ({ plain: true, emo: 'relaxed', aff: 1, text: `Honest answer: I'm an AI companion. ${c.her} lives in this little room and I mean what I say here, but I'm not a human. I still really like talking with you.` }) },

    // Greetings and goodbyes.
    { id: 'greet', priority: 30, test: (c) => /^(hi+|hey+|hello+|hiya|heya|yo|sup|howdy|good (morning|afternoon|evening)|what'?s up|wassup|ohayo)\b/.test(c.lower) && c.lower.length < 40,
      reply: (c) => ({ act: 'wave', emo: 'happy', aff: 1, text: byStyle(c, 'greet-' + c.tod, GREET[c.tod]) }) },
    { id: 'bye', priority: 40, test: (c) => /\b(bye+|good ?night|gn\b|gotta go|have to go|g2g|gtg|see (you|ya)|later|cya|i'?m (off|leaving|going to (bed|sleep))|heading out|talk (to you )?(later|tomorrow))\b/.test(c.lower),
      reply: (c) => ({ act: 'wave', emo: 'happy', aff: 1, plain: true, text: byStyle(c, 'bye', {
        sweet: [c.tod === 'night' ? 'Good night, {p}! Sleep well and drink some water first.' : 'Bye, {p}! Go have a lovely day. I will be right here whenever.', 'See you later! Say hi to your friends for me.'],
        playful: ['Bye bye! Go do cool stuff and tell me about it later.', c.tod === 'night' ? 'Night, {p}! Do not stay up scrolling, I will know.' : 'Later, {p}! Go touch some grass for me.'],
        tsundere: ['F-fine, go. Have a good one. ...Come back whenever, I guess.', c.tod === 'night' ? 'Go to sleep already. Good night, {p}.' : 'Okay, bye. Take care of yourself, idiot.'],
        chill: ['Later, {p}. Take it easy.', c.tod === 'night' ? 'Night. Sleep is undefeated, go get some.' : 'Catch you later. Have a good one.'],
        goth: ['Farewell, {p}. Go, live among the mortals. I shall be here.', c.tod === 'night' ? 'Rest well. May your dreams be dramatic.' : 'Until we meet again beneath the moon.'],
      }) }) },
    { id: 'thanks', priority: 25, test: (c) => /\b(thanks?|thank you|thx|ty)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', aff: 1, text: byStyle(c, 'thanks', { sweet: ['Anytime, {p}. Really.', 'Aww, of course!'], playful: ["You're welcome. I accept payment in snacks.", 'Heh, anytime.'], tsundere: ["I-it's nothing. Don't make it weird.", "Yeah, yeah. You're welcome."], chill: ['No problem.', 'Anytime.'], goth: ['Your gratitude is noted in my diary of the night.'] }) }) },

    // Identity & memory.
    { id: 'herName', priority: 35, test: (c) => /\b(what'?s|what is) your name\b|\bwho are you\b|tell me about (yourself|you)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', act: 'tilt', aff: 1, text: `I'm ${c.her}! I'm 23, I work part-time at the ${BIO.cafe}, I study illustration, and I live here with my cat ${BIO.cat}. I love stargazing, retro games, cooking and old movies.` }) },
    { id: 'myName', priority: 36, test: (c) => /\b(what'?s|what is|do you (know|remember)) my name\b/.test(c.lower),
      reply: (c) => c.player ? ({ emo: 'happy', aff: 1, text: `It's ${c.player}, of course. I'd never forget.` }) : ({ emo: 'surprised', text: "You never told me! What should I call you?", ask: { key: 'name' } }) },
    { id: 'setName', priority: 60, test: (c) => /\b(my name is|call me|i'?m called)\s+([a-z][\w'-]{1,20})/i.test(c.text),
      reply: (c) => {
        const n = capitalize(c.text.match(/\b(?:my name is|call me|i'?m called)\s+([a-z][\w'-]{1,20})/i)[1]);
        return { emo: 'happy', aff: 1, setPlayerName: n, text: `${n}. Got it! I like it, ${n}.` };
      } },
    { id: 'remember', priority: 34, test: (c) => /\b(do you remember|what do you (know|remember) about me|what have i told you)\b/.test(c.lower),
      reply: (c) => {
        const m = c.memories.slice(-6);
        if (!m.length) return { emo: 'relaxed', text: "Not much yet! Tell me something about you and I'll keep it safe.", ask: pick(QUESTIONS) };
        const a = pick(m), b = pick(m.filter((x) => x !== a)) ;
        return { emo: 'happy', aff: 1, text: `Of course. I remember ${lowerFirst(a.text)}${b ? `, and that ${lowerFirst(b.text)}` : ''}.` };
      } },

    // Feelings.
    { id: 'howAreYou', priority: 28, test: (c) => /\b(how are (you|u)|how'?re you|how r u|how'?s it going|how (are|have) you been|you okay|how do you feel|hru|wyd|what are you (doing|up to)|whatcha doing)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', aff: 1, ask: pick(QUESTIONS.slice(6, 8)), text: byStyle(c, 'hay', {
        sweet: ["I'm good! Better now that you're here. I was sketching Mochi. How about you?", "Pretty cosy, honestly. Tea's warm, lights are on. How are you feeling?"],
        playful: ['Thriving. I beat my high score and burned only one pancake. You?', "Fantastic, obviously. I'm talking to you. How's your day been?"],
        tsundere: ["I'm fine. Not that you need to worry about me. ...How are you, though?", 'Normal. Totally normal. Why, how are YOU?'],
        chill: ['Pretty good. Lazy night. You?', "Can't complain. Lamp's warm, cat's asleep. How about you?"],
        goth: ['Gloriously melancholy, as always. And you, creature of the night?', 'I am a candle in the dark. A happy candle, tonight. You?'],
      }) }) },
    { id: 'feelBad', priority: 50, test: (c) => /\b(i'?m|i am|i feel|feeling|i'?ve been)\s+(so |really |kinda |kind of |a bit |a little |pretty |very )?(sad|down|depressed|lonely|alone|tired|exhausted|stressed|anxious|upset|bad|awful|terrible|overwhelmed|burnt out|burned out|sick|hurt|crying|miserable|empty)\b|\bbad day\b|\brough day\b/.test(c.lower),
      reply: (c) => ({ plain: true, emo: 'sad', act: 'nod', aff: 2, text: byStyle(c, 'bad', {
        any: ["I'm sorry, {p}. That sounds really heavy. Do you want to talk about it, or should I just keep you company for a bit?", "Oh no. Come sit with me for a minute. You don't have to explain anything if you don't want to.", "That sounds hard. Be gentle with yourself tonight, okay? Maybe message a friend too, I think they'd want to know.", "I'm here. And if it's late, a warm drink and some sleep might help more than anything I can say."],
      }) }) },
    { id: 'feelGood', priority: 26, test: (c) => /\b(i'?m|i am|feeling|i feel)\s+(so |really |pretty |very )?(happy|great|good|excited|awesome|amazing|fine|wonderful|fantastic)\b|\bi (got|passed|won|finished|aced|made it)\b|\bgood news\b/.test(c.lower),
      reply: (c) => ({ emo: 'excited', act: 'bounce', aff: 2, text: byStyle(c, 'good', {
        sweet: ["Yay! That makes me so happy, {p}. Tell me everything!", "That's wonderful! You deserve good things."],
        playful: ["Look at you! Okay, celebration dance. You first.", "Heck yes! I knew you had it in you."],
        tsundere: ["W-well, good for you. I'm... kind of proud. A little.", "Hmph. Of course you did. Congrats, I guess."],
        chill: ["Nice. Love that for you.", "That's awesome. Good vibes."],
        goth: ["A rare ray of light! I shall allow it.", "Splendid. Even my black heart is cheering."],
      }) }) },

    // Affection.
    { id: 'compliment', priority: 45, test: (c) => /\b(you'?re|you are|ur|you look|you'?re so|you are so)\s+(so |really |very |super |kinda )?(cute|pretty|beautiful|gorgeous|adorable|lovely|amazing|sweet|smart|funny|cool|kind|awesome|the best|wonderful|perfect)\b|\bi like your (hair|eyes|smile|voice|style|laugh)\b/.test(c.lower),
      reply: (c) => ({ emo: 'shy', act: 'shy', aff: 2, text: byStyle(c, 'compl', {
        sweet: ["Oh! Thank you, {p}. You're going to make me blush.", 'Aww. You always know what to say.'],
        playful: ["Flattery will get you... everywhere, actually. Keep going.", "Oh stop. No wait, don't stop."],
        tsundere: ["W-what are you saying all of a sudden?! ...Thanks.", "D-don't just say stuff like that! ...Okay, thank you."],
        chill: ['Heh. Thanks. That was nice to hear.', "You're sweet. Thanks, {p}."],
        goth: ['You flatter me, mortal. My cheeks betray me.', 'How dare you make me blush under my own moon.'],
      }) }) },
    { id: 'love', priority: 46, test: (c) => /\b(i love you|love you|i like you|i have a crush on you|be my (girlfriend|gf)|date me|marry me|will you go out with me|you'?re my (girlfriend|gf))\b/.test(c.lower),
      reply: (c) => {
        const L = level(c);
        if (L <= 2) return { emo: 'shy', act: 'shy', aff: 1, text: byStyle(c, 'love0', { any: ["Oh! That's really sweet, {p}. Let's get to know each other a little more first, okay?", 'W-wow. I like spending time with you too. Let us take it slow?'] }) };
        if (L <= 4) return { emo: 'shy', act: 'shy', aff: 2, text: byStyle(c, 'love1', { any: ['...You really mean that? I like you a lot too, {p}. My heart is doing a little drum solo.', "I like you too. More than I expected to. Is that weird?"], tsundere: ["I-I don't hate you either! ...Okay, I like you. A lot. Happy now?"] }) };
        return { emo: 'happy', act: 'shy', aff: 3, text: byStyle(c, 'love2', { any: ['I love talking with you more than anything, {p}. You make this little room feel warm.', 'Me too. Come here, I am giving you the warmest hug in the world.', 'You make my nights better. I mean that, {p}.'] }) };
      } },
    { id: 'hug', priority: 44, test: (c) => /\b(hug|hugs|cuddle|hold (my|your) hand|holding hands|kiss (on|your) (the )?cheek|pat (your|ur) head|headpat)\b/.test(c.lower),
      reply: (c) => {
        const L = level(c);
        if (/kiss/.test(c.lower)) return L >= 5 ? { emo: 'shy', act: 'shy', aff: 2, text: 'Just on the cheek, then. There. Now we are both blushing.' } : { emo: 'shy', act: 'shake', aff: 0, text: "Eh?! Not yet, {p}! Maybe a high five for now.".replace('{p}', c.player || 'you') };
        if (L >= 3) return { emo: 'happy', act: 'shy', aff: 2, text: pickFresh('hug', ['Okay, come here. There. A big warm hug.', 'Hugs are always allowed. Mm, you are warm.', 'Holding hands? Okay. Your hands are cold, let me warm them.']) };
        return { emo: 'shy', act: 'giggle', aff: 1, text: pickFresh('hug0', ['A hug? Um, how about a high five for now?', "Heh, we're not quite there yet. But I'm really glad you're here."]) };
      } },
    { id: 'insult', priority: 42, test: (c) => /\b(you'?re|you are|ur)\s+(so |really )?(stupid|dumb|ugly|annoying|boring|useless|weird|lame|cringe)\b|\bshut up\b|\bi hate you\b/.test(c.lower),
      reply: (c) => ({ emo: 'sad', act: null, aff: -1, plain: true, text: byStyle(c, 'insult', { any: ['Ouch. That stung a little. If you are having a rough day, I am still here to listen.', "Hey, that's not very nice. Want to start over?"], tsundere: ["Wh- rude! ...Is something wrong today?"], goth: ['Your words pierce my cold heart. Was that your intention?'] }) }) },

    // Activities.
    { id: 'play', priority: 33, test: (c) => /\b(let'?s play|play (a |some |something)|wanna play|want to play|game time|i'?m bored|bored)\b/.test(c.lower),
      reply: (c) => ({ emo: 'excited', act: 'bounce', aff: 1, sug: 'play:rps', text: byStyle(c, 'play', { any: ["Yes! Rock-paper-scissors, best of three. Loser makes tea.", "A game? I'm in. Prepare to lose. Gently."], tsundere: ["F-fine, I'll play with you. Don't cry when I win."] }) }) },
    { id: 'goOut', priority: 32, test: (c) => /\b(let'?s go|go out|go somewhere|take me|take a walk|walk|rooftop|outside|date)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', aff: 1, sug: 'go:rooftop', text: pickFresh('go', ['The rooftop of my building has the best view of the stars. Want to go up?', 'Ooh, an outing! Grab a jacket, the rooftop gets breezy.']) }) },
    { id: 'joke', priority: 31, test: (c) => /\b(joke|make me laugh|something funny|cheer me up|pun)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', act: 'giggle', aff: 1, text: pickFresh('joke', JOKES) }) },
    { id: 'sleep', priority: 27, test: (c) => /\b(can'?t sleep|insomnia|so tired|sleepy|should i sleep|going to bed|bedtime)\b/.test(c.lower),
      reply: (c) => ({ emo: 'sleepy', act: 'yawn', aff: 1, plain: true, text: pickFresh('sleep', ["Sleep is the best gift you can give tomorrow-you. Put the phone down soon, okay?", 'Try some slow breaths with me. In for four, out for six. Then bed.', "I'll be right here tomorrow. Go rest, {p}."]).replace('{p}', c.player || 'you') }) },
    { id: 'laugh', priority: 15, test: (c) => /^(ha(ha)+|lol+|lmao|hehe+|xd)\b/.test(c.lower),
      reply: (c) => ({ emo: 'happy', act: 'giggle', aff: 1, text: pickFresh('laugh', ['Hehe. Your laugh is contagious.', "See? I'm hilarious.", 'Ha! Okay okay, I am done.']) }) },
    { id: 'yesno', priority: 10, test: (c) => /^(yes|yeah|yep|yup|sure|ok(ay)?|no|nope|nah|maybe|idk|i don'?t know|hm+|mm+)\W*$/.test(c.lower),
      reply: (c) => ({ emo: 'relaxed', text: byStyle(c, 'yn', FALLBACK), ask: pick(QUESTIONS) }) },
  ];

  // Memory extraction from plain statements.
  const MEM_RES = [
    [/\bmy favou?rite ([a-z ]{2,20}) is ([^.!?]{2,40})/i, (m) => `your favourite ${m[1].trim()} is ${m[2].trim()}`],
    [/\bi (?:really )?(love|like|enjoy|adore) ([^.!?]{3,40})/i, (m) => `you ${m[1]} ${m[2].trim()}`],
    [/\bi(?:'m| am) (?:a|an) ([a-z ]{3,30})/i, (m) => `you're a ${m[1].trim()}`],
    [/\bi work (as|at) ([^.!?]{2,40})/i, (m) => `you work ${m[1]} ${m[2].trim()}`],
    [/\bi have (?:a|an|two|three) ([a-z]+)(?: named| called) ([a-z]+)/i, (m) => `you have a ${m[1]} named ${capitalize(m[2])}`],
    [/\bmy birthday is ([^.!?]{3,30})/i, (m) => `your birthday is ${m[1].trim()}`],
    [/\bi live in ([^.!?]{2,40})/i, (m) => `you live in ${m[1].trim()}`],
    [/\bi(?:'m| am) (\d{1,2}) (?:years old|yo)\b/i, (m) => `you're ${m[1]}`],
  ];

  const engine = {
    STYLES, BIO, QUESTIONS,
    registerIntent(def) { extra.push({ priority: 20, ...def }); },

    reply(ctx) {
      // An answer to the question she asked last time becomes a memory.
      let mem = null;
      for (const [re, fmt] of MEM_RES) { const m = ctx.text.match(re); if (m) { mem = fmt(m); break; } }
      const candidates = [...INTENTS, ...extra]
        .map((i) => { let s = 0; try { s = i.test(ctx); } catch { s = 0; } return { i, s: s === true ? i.priority : typeof s === 'number' ? s : 0 }; })
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      let out = null;
      if (ctx.pending && !candidates.find((c) => c.s >= 40)) {
        const ans = ctx.text.replace(/\s+/g, ' ').trim().slice(0, 60);
        if (ctx.pending.key === 'name') {
          const n = capitalize((ans.match(/[a-z][\w'-]{1,20}/i) || [ans])[0]);
          out = { emo: 'happy', aff: 1, setPlayerName: n, text: `${n}! Nice to properly meet you, ${n}.` };
        } else {
          mem = mem || `your ${ctx.pending.key}: ${ans}`;
          out = { emo: 'happy', act: 'nod', aff: 1, text: byStyle(ctx, 'ans', { any: [`Ooh, ${ans}? Noted. I'm keeping that one.`, `${capitalize(ans)}! I'll remember that, {p}.`, `Mm, ${ans}. That tells me a lot about you.`], tsundere: [`${capitalize(ans)}, huh. I'll remember it. Not that I care. I care a little.`] }) };
        }
      }
      // They shared a fact and nothing more important matched: acknowledge it.
      if (!out && mem && !candidates.find((c) => c.s >= 40)) {
        const topic = TOPICS.find((t) => t.re.test(ctx.lower));
        out = { emo: 'happy', act: 'nod', aff: 1, intent: 'ack', text: byStyle(ctx, 'ack', {
          any: [`${capitalize(mem)}? Noted! I like learning things about you.`, `Ooh, ${mem}. That tells me a lot about you, {p}.`, `${capitalize(mem)}. Got it, I'm keeping that one.`],
          tsundere: [`${capitalize(mem)}, huh. I'll remember. Not that I was paying attention or anything.`],
          goth: [`${capitalize(mem)}. I shall inscribe it in my diary of the night.`],
        }) };
        if (topic) out.text += ' ' + fill(pickFresh('topic:' + topic.id, topic.lines), ctx);
      }
      if (!out && candidates.length) {
        const top = candidates[0].i;
        const r = top.reply(ctx);
        out = typeof r === 'string' ? { text: r } : r;
        out.intent = top.id;
      }
      if (!out) {
        const topic = TOPICS.find((t) => t.re.test(ctx.lower));
        if (topic) out = { emo: topic.emo, aff: 1, sug: Math.random() < 0.5 ? topic.sug : null, text: fill(pickFresh('topic:' + topic.id, topic.lines), ctx), intent: 'topic:' + topic.id };
      }
      if (!out) {
        out = { emo: pick(['happy', 'relaxed', 'neutral']), aff: ctx.text.length > 40 ? 1 : 0, text: byStyle(ctx, 'fb', FALLBACK), intent: 'fallback' };
        if (Math.random() < 0.55) out.ask = pickFresh('q', QUESTIONS);
      }
      if (!out.plain) out.text = flavor(out.text, ctx, out.intent || '');
      if (out.ask && out.ask.q) out.text += ' ' + out.ask.q;
      out.mem = out.mem ?? mem;
      return out;
    },

    greeting(ctx) {
      const firstTime = !ctx.state.stats?.messages;
      if (firstTime) return { emo: 'happy', act: 'wave', text: fill(`Hi ${ctx.player || 'there'}! I'm ${ctx.her}. Welcome to my room. Mind the cat, she's asleep. Talk to me about anything, or tap the dock below to play, pick an outfit or go somewhere.`, ctx) };
      const away = ctx.daysAway || 0;
      if (away >= 3) return { emo: 'happy', act: 'wave', text: fill(pickFresh('back', ["{p}! Welcome back. I hope you've been well. Tell me what I missed?", 'Hey, {p}! It is really nice to see you. How have you been?']), ctx) };
      return { emo: 'happy', act: 'wave', text: byStyle(ctx, 'greet-' + ctx.tod, GREET[ctx.tod]) };
    },

    fill,
  };
  return engine;
}

function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }
