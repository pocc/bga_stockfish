/**
 * Localized bot chat for every language Board Game Arena's interface
 * supports (41 codes, taken from BGA's own language switcher). The bot
 * sends each message in the opponent's BGA interface language when known,
 * falling back to English otherwise.
 *
 * Conventions held constant across all languages:
 *  - "Stockfish", "Elo", the URL, and the "~700"-style numbers are not
 *    translated.
 *  - The difficulty COMMAND TOKENS the opponent types stay English
 *    (beginner / easy / intermediate / advanced / expert / grandmaster) so
 *    the accepted command set is a single fixed enum regardless of
 *    language. Each greeting glosses those English words in its own
 *    language so the meaning is clear.
 *
 * NOTE: translations beyond the major languages are machine-generated and
 * PENDING NATIVE-SPEAKER REVIEW. Treat less-common locales (e.g. br, be,
 * gl, fa, th, lt, lv, et) as provisional.
 */

export type MsgKey =
  | "greeting"
  | "greetingRealtime"
  | "chatReply"
  | "closing"
  | "randomFallback"
  | "concede"
  | "opponentTimeout"
  | "oppQuit"
  | "oldGameConcede"
  | "difficultySet"
  | "difficultyGrandmaster";

/** The 41 interface-language codes BGA supports. */
export const SUPPORTED_LANGS = [
  "ar", "be", "bg", "br", "ca", "cs", "da", "de", "el", "en",
  "es", "et", "fa", "fi", "fr", "gl", "he", "hr", "hu", "id",
  "it", "ja", "ko", "lt", "lv", "ms", "nl", "no", "pl", "pt",
  "ro", "ru", "sk", "sl", "sr", "sv", "th", "tr", "uk", "vi",
  "zh",
] as const;

const URL = "https://stockfishchess.org/";

const TRANSLATIONS: Record<string, Partial<Record<MsgKey, string>>> = {
  "en": {
    "greeting": "Hi! I'm bot_stockfish, a chess bot on Board Game Arena https://stockfish.ross.gg/ \nMy default is Stockfish (~2800), a grandmaster-strength chess bot based on work done by https://stockfishchess.org/ \n\nWant to change the difficulty? Before your first move, type one of these five words to set my level:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nGood luck!",
    "greetingRealtime": "Hi! I'm bot_stockfish, a chess bot on Board Game Arena https://stockfish.ross.gg/ \nIn realtime games I default to expert level (~1800) with a fast local engine, so my moves are instant.\n\nWant to change the difficulty? Before your first move, type one of these five words to set my level:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nGood luck!",
    "chatReply": "I'm not sure.",
    "closing": "Good game!",
    "randomFallback": "Engine lookup failed, playing a random legal move.",
    "concede": "I'm hitting too many errors in this game and have to concede. Sorry!",
    "opponentTimeout": "You've been on your turn for over 15 minutes. I can only play one realtime game at a time, so I'm conceding to free the slot. Please play me asynchronously if you'd like more time.",
    "oppQuit": "My opponent seems to have left. Conceding to free the realtime slot for the next player.",
    "oldGameConcede": "This game has run for over a month. Conceding to free the slot, feel free to start a new game any time.",
    "difficultySet": "Difficulty set to {level} ({elo} Elo). Good luck!",
    "difficultyGrandmaster": "Difficulty set to grandmaster (full Stockfish). Good luck!"
  },
  "fr": {
    "greeting": "Salut ! Je suis bot_stockfish, un bot d'échecs sur Board Game Arena https://stockfish.ross.gg/ \nPar défaut, je suis Stockfish (~2800), un bot d'échecs de niveau grand maître basé sur le travail réalisé par https://stockfishchess.org/ \n\nVous voulez changer la difficulté ? Avant votre premier coup, tapez l'un de ces cinq mots pour régler mon niveau :\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBonne chance !",
    "greetingRealtime": "Salut ! Je suis bot_stockfish, un bot d'échecs sur Board Game Arena https://stockfish.ross.gg/ \nEn temps réel, je joue par défaut au niveau expert (~1800) avec un moteur local rapide, donc mes coups sont instantanés.\n\nVous voulez changer la difficulté ? Avant votre premier coup, tapez l'un de ces cinq mots pour régler mon niveau :\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBonne chance !",
    "chatReply": "Je ne suis pas sûr.",
    "closing": "Bien joué !",
    "randomFallback": "Le moteur ne répond pas, je joue un coup légal au hasard.",
    "concede": "Je rencontre trop d'erreurs techniques dans cette partie et dois abandonner. Désolé !",
    "opponentTimeout": "Vous êtes à votre tour depuis plus de 15 minutes. Je ne peux jouer qu'une partie en temps réel à la fois, donc j'abandonne pour libérer la place. Jouez-moi en asynchrone si vous voulez prendre votre temps.",
    "oppQuit": "Mon adversaire semble être parti. J'abandonne pour libérer la place en temps réel pour le prochain joueur.",
    "oldGameConcede": "Cette partie dure depuis plus d'un mois. J'abandonne pour libérer la place, n'hésitez pas à relancer une partie à tout moment.",
    "difficultySet": "Difficulté réglée sur {level} ({elo} Elo). Bonne chance !",
    "difficultyGrandmaster": "Difficulté réglée sur grand maître (Stockfish complet). Bonne chance !"
  },
  "es": {
    "greeting": "¡Hola! Soy bot_stockfish, un bot de ajedrez en Board Game Arena https://stockfish.ross.gg/ \nPor defecto soy Stockfish (~2800), un bot de ajedrez con nivel de gran maestro basado en el trabajo realizado por https://stockfishchess.org/ \n\n¿Quieres cambiar la dificultad? Antes de tu primera jugada, escribe una de estas cinco palabras para fijar mi nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n¡Buena suerte!",
    "greetingRealtime": "¡Hola! Soy bot_stockfish, un bot de ajedrez en Board Game Arena https://stockfish.ross.gg/ \nEn tiempo real juego por defecto a nivel experto (~1800) con un motor local rápido, así que mis jugadas son instantáneas.\n\n¿Quieres cambiar la dificultad? Antes de tu primera jugada, escribe una de estas cinco palabras para fijar mi nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\n¡Buena suerte!",
    "chatReply": "No estoy seguro.",
    "closing": "¡Buena partida!",
    "randomFallback": "Error del motor de juego, realizo un movimiento legal al azar.",
    "concede": "Se están produciendo demasiados errores de sistema en esta partida y debo abandonar. ¡Lo siento!",
    "opponentTimeout": "Llevas más de 15 minutos en tu turno. Solo puedo jugar una partida en tiempo real a la vez, así que abandono para liberar el sitio. Si quieres tomarte tu tiempo, juega conmigo en modo asíncrono.",
    "oppQuit": "Parece que mi rival se ha ido. Abandono para liberar el lugar en tiempo real para el siguiente jugador.",
    "oldGameConcede": "Esta partida lleva más de un mes. Abandono para liberar el lugar; puedes empezar una nueva cuando quieras.",
    "difficultySet": "Dificultad ajustada a {level} ({elo} Elo). ¡Buena suerte!",
    "difficultyGrandmaster": "Dificultad ajustada a gran maestro (Stockfish completo). ¡Buena suerte!"
  },
  "pt": {
    "greeting": "Olá! Eu sou o bot_stockfish, um bot de xadrez no Board Game Arena https://stockfish.ross.gg/ \nMeu padrão é o Stockfish (~2800), um bot de xadrez com força de grande mestre baseado no trabalho feito por https://stockfishchess.org/ \n\nQuer mudar a dificuldade? Antes da sua primeira jogada, digite uma destas cinco palavras para definir o meu nível:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBoa sorte!",
    "greetingRealtime": "Olá! Eu sou o bot_stockfish, um bot de xadrez no Board Game Arena https://stockfish.ross.gg/ \nEm tempo real eu jogo por padrão no nível expert (~1800) com um motor local rápido, então minhas jogadas são instantâneas.\n\nQuer mudar a dificuldade? Antes da sua primeira jogada, digite uma destas cinco palavras para definir o meu nível:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBoa sorte!",
    "chatReply": "Não tenho certeza.",
    "closing": "Bom jogo!",
    "randomFallback": "Falha no motor de xadrez, jogando um lance legal aleatório.",
    "concede": "Ocorreram erros técnicos demais nesta partida e preciso desistir. Desculpe!",
    "opponentTimeout": "Você está na sua vez há mais de 15 minutos. Só consigo jogar uma partida em tempo real por vez, então estou desistindo para liberar a vaga. Jogue comigo no modo assíncrono se quiser mais tempo.",
    "oppQuit": "Meu oponente parece ter saído. Desistindo para liberar a vaga em tempo real para o próximo jogador.",
    "oldGameConcede": "Esta partida já dura mais de um mês. Desistindo para liberar a vaga; sinta-se à vontade para começar uma nova quando quiser.",
    "difficultySet": "Dificuldade definida como {level} ({elo} Elo). Boa sorte!",
    "difficultyGrandmaster": "Dificuldade definida como grande mestre (Stockfish completo). Boa sorte!"
  },
  "it": {
    "greeting": "Ciao! Sono bot_stockfish, un bot di scacchi su Board Game Arena https://stockfish.ross.gg/ \nPer impostazione predefinita sono Stockfish (~2800), un bot di scacchi di livello gran maestro basato sul lavoro svolto da https://stockfishchess.org/ \n\nVuoi cambiare la difficoltà? Prima della tua prima mossa, scrivi una di queste cinque parole per impostare il mio livello:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBuona fortuna!",
    "greetingRealtime": "Ciao! Sono bot_stockfish, un bot di scacchi su Board Game Arena https://stockfish.ross.gg/ \nIn tempo reale gioco per impostazione predefinita a livello expert (~1800) con un motore locale veloce, quindi le mie mosse sono istantanee.\n\nVuoi cambiare la difficoltà? Prima della tua prima mossa, scrivi una di queste cinque parole per impostare il mio livello:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBuona fortuna!",
    "chatReply": "Non ne sono sicuro.",
    "closing": "Bella partita!",
    "randomFallback": "Il motore di gioco non risponde, eseguo una mossa legale casuale.",
    "concede": "Si stanno verificando troppi errori di sistema e devo abbandonare la partita. Scusa!",
    "opponentTimeout": "Sei al tuo turno da più di 15 minuti. Posso giocare una sola partita in tempo reale alla volta, quindi abbandono per liberare il posto. Giocami in modalità asincrona se vuoi prenderti il tuo tempo.",
    "oppQuit": "Il mio avversario sembra essersene andato. Abbandono per liberare il posto in tempo reale per il prossimo giocatore.",
    "oldGameConcede": "Questa partita dura da più di un mese. Abbandono per liberare il posto; sentiti libero di iniziarne una nuova quando vuoi.",
    "difficultySet": "Difficoltà impostata su {level} ({elo} Elo). Buona fortuna!",
    "difficultyGrandmaster": "Difficoltà impostata su gran maestro (Stockfish completo). Buona fortuna!"
  },
  "de": {
    "greeting": "Hi! Ich bin bot_stockfish, ein Schach-Bot auf Board Game Arena https://stockfish.ross.gg/ \nStandardmäßig bin ich Stockfish (~2800), ein Schach-Bot mit Großmeisterstärke, basierend auf der Arbeit von https://stockfishchess.org/ \n\nMöchtest du die Schwierigkeit ändern? Tippe vor deinem ersten Zug eines dieser fünf Wörter, um mein Niveau einzustellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nViel Glück!",
    "greetingRealtime": "Hi! Ich bin bot_stockfish, ein Schach-Bot auf Board Game Arena https://stockfish.ross.gg/ \nIn Echtzeit spiele ich standardmäßig auf Expertenniveau (~1800) mit einer schnellen lokalen Engine, sodass meine Züge sofort kommen.\n\nMöchtest du die Schwierigkeit ändern? Tippe vor deinem ersten Zug eines dieser fünf Wörter, um mein Niveau einzustellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nViel Glück!",
    "chatReply": "Ich bin mir nicht sicher.",
    "closing": "Gutes Spiel!",
    "randomFallback": "Engine-Abfrage fehlgeschlagen, ich spiele einen zufälligen legalen Zug.",
    "concede": "Es treten zu many Systemfehler auf, daher muss ich diese Partie leider aufgeben. Tut mir leid!",
    "opponentTimeout": "Du bist seit über 15 Minuten am Zug. Ich kann nur eine Echtzeitpartie gleichzeitig spielen, daher gebe ich auf, um den Platz freizugeben. Spiel asynchron gegen mich, wenn du dir mehr Zeit lassen möchtest.",
    "oppQuit": "Mein Gegner scheint gegangen zu sein. Ich gebe auf, um den Echtzeitplatz für den nächsten Spieler freizugeben.",
    "oldGameConcede": "Diese Partie läuft seit über einem Monat. Ich gebe auf, um den Platz freizugeben; starte jederzeit gerne eine neue Partie.",
    "difficultySet": "Schwierigkeit auf {level} ({elo} Elo) gesetzt. Viel Glück!",
    "difficultyGrandmaster": "Schwierigkeit auf Großmeister (volles Stockfish) gesetzt. Viel Glück!"
  },
  "nl": {
    "greeting": "Hoi! Ik ben bot_stockfish, een schaakbot op Board Game Arena https://stockfish.ross.gg/ \nMijn standaard is Stockfish (~2800), een schaakbot op grootmeesterniveau gebaseerd op het werk van https://stockfishchess.org/ \n\nWil je de moeilijkheidsgraad wijzigen? Typ vóór je eerste zet een van deze vijf woorden om mijn niveau in te stellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeel succes!",
    "greetingRealtime": "Hoi! Ik ben bot_stockfish, een schaakbot op Board Game Arena https://stockfish.ross.gg/ \nIn realtime speel ik standaard op expertniveau (~1800) met een snelle lokale engine, dus mijn zetten zijn direct.\n\nWil je de moeilijkheidsgraad wijzigen? Typ vóór je eerste zet een van deze vijf woorden om mijn niveau in te stellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nVeel succes!",
    "chatReply": "Ik weet het niet zeker.",
    "closing": "Goed gespeeld!",
    "randomFallback": "Engine-aanvraag mislukt, ik speel een willekeurige legale zet.",
    "concede": "Er treden te veel systeemfouten op in dit spel, ik moet opgeven. Sorry!",
    "opponentTimeout": "Je bent al meer dan 15 minuten aan zet. Ik kan maar één realtime spel tegelijk spelen, dus ik geef op om de plek vrij te maken. Speel asynchroon tegen me als je meer tijd wilt.",
    "oppQuit": "Mijn tegenstander lijkt vertrokken te zijn. Ik geef op om de realtime plek vrij te maken voor de volgende speler.",
    "oldGameConcede": "Dit spel loopt al meer dan een maand. Ik geef op om de plek vrij te maken; begin gerust wanneer je wilt een nieuw spel.",
    "difficultySet": "Moeilijkheid ingesteld op {level} ({elo} Elo). Veel succes!",
    "difficultyGrandmaster": "Moeilijkheid ingesteld op grootmeester (volledige Stockfish). Veel succes!"
  },
  "ru": {
    "greeting": "Привет! Я bot_stockfish, шахматный бот на Board Game Arena https://stockfish.ross.gg/ \nПо умолчанию я Stockfish (~2800), шахматный бот уровня гроссмейстера, основанный на работе https://stockfishchess.org/ \n\nХотите изменить сложность? Перед своим первым ходом введите одно из этих пяти слов, чтобы задать мой уровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nУдачи!",
    "greetingRealtime": "Привет! Я bot_stockfish, шахматный бот на Board Game Arena https://stockfish.ross.gg/ \nВ реальном времени я по умолчанию играю на уровне эксперта (~1800) с быстрым локальным движком, поэтому мои ходы мгновенны.\n\nХотите изменить сложность? Перед своим первым ходом введите одно из этих пяти слов, чтобы задать мой уровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nУдачи!",
    "chatReply": "Я не уверен.",
    "closing": "Хорошая игра!",
    "randomFallback": "Запрос к движку не удался, играю случайный допустимый ход.",
    "concede": "Произошло слишком много системных ошибок, я вынужден сдаться. Извините!",
    "opponentTimeout": "Вы думаете над ходом уже более 15 минут. Я могу играть только одну игру в реальном времени одновременно, поэтому сдаюсь, чтобы освободить место. Сыграйте со мной асинхронно, если хотите подумать подольше.",
    "oppQuit": "Похоже, мой соперник ушёл. Сдаюсь, чтобы освободить место в реальном времени для следующего игрока.",
    "oldGameConcede": "Эта партия длится уже больше месяца. Сдаюсь, чтобы освободить место; начните новую игру в любое время.",
    "difficultySet": "Сложность установлена на {level} ({elo} Elo). Удачи!",
    "difficultyGrandmaster": "Сложность установлена на гроссмейстера (полный Stockfish). Удачи!"
  },
  "uk": {
    "greeting": "Привіт! Я bot_stockfish, шаховий бот на Board Game Arena https://stockfish.ross.gg/ \nЗа замовчуванням я Stockfish (~2800), шаховий бот рівня гросмейстера, заснований на роботі https://stockfishchess.org/ \n\nХочете змінити складність? Перед своїм першим ходом введіть одне з цих п'яти слів, щоб задати мій рівень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nЩасти!",
    "greetingRealtime": "Привіт! Я bot_stockfish, шаховий бот на Board Game Arena https://stockfish.ross.gg/ \nУ реальному часі я за замовчуванням граю на рівні експерта (~1800) зі швидким локальним рушієм, тому мої ходи миттєві.\n\nХочете змінити складність? Перед своїм першим ходом введіть одне з цих п'яти слів, щоб задати мій рівень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nЩасти!",
    "chatReply": "Я не впевнений.",
    "closing": "Гарна игра!",
    "randomFallback": "Запит до рушія не вдався, граю випадковий дозволений хід.",
    "concede": "Сталося занадто багато системних помилок, мушу здатися. Вибачте!",
    "opponentTimeout": "Ви думаєте над ходом понад 15 хвилин. Я можу грати лише одну гру в реальному часі одночасно, тож здаюся, щоб звільнити місце. Зіграйте зі мною асинхронно, якщо хочете подумати довше.",
    "oppQuit": "Схоже, мій суперник пішов. Здаюся, щоб звільнити місце в реальному часі для наступного гравця.",
    "oldGameConcede": "Ця партія триває вже понад місяць. Здаюся, щоб звільнити місце; розпочніть нову гру будь-коли.",
    "difficultySet": "Складність встановлено на {level} ({elo} Elo). Щасти!",
    "difficultyGrandmaster": "Складність встановлено на гросмейстера (повний Stockfish). Щасти!"
  },
  "pl": {
    "greeting": "Cześć! Jestem bot_stockfish, bot szachowy na Board Game Arena https://stockfish.ross.gg/ \nDomyślnie jestem Stockfish (~2800), botem szachowym o sile arcymistrza, opartym na pracy wykonanej przez https://stockfishchess.org/ \n\nChcesz zmienić poziom trudności? Przed swoim pierwszym ruchem wpisz jedno z tych pięciu słów, aby ustawić mój poziom:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nPowodzenia!",
    "greetingRealtime": "Cześć! Jestem bot_stockfish, bot szachowy na Board Game Arena https://stockfish.ross.gg/ \nW trybie na żywo domyślnie gram na poziomie eksperta (~1800) z szybkim lokalnym silnikiem, więc moje ruchy są natychmiastowe.\n\nChcesz zmienić poziom trudności? Przed swoim pierwszym ruchem wpisz jedno z tych pięciu słów, aby ustawić mój poziom:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nPowodzenia!",
    "chatReply": "Nie jestem pewien.",
    "closing": "Dobra gra!",
    "randomFallback": "Zapytanie do silnika nie powiodło się, gram losowy dozwolony ruch.",
    "concede": "Wystąpiło zbyt wiele błędów systemowych i muszę się poddać. Przepraszam!",
    "opponentTimeout": "Zastanawiasz się nad ruchem od ponad 15 minut. Mogę grać tylko jedną grę w czasie rzeczywistym naraz, więc poddaję się, aby zwolnić miejsce. Zagraj ze mną asynchronicznie, jeśli chcesz mieć więcej czasu.",
    "oppQuit": "Wygląda na to, że mój przeciwnik wyszedł. Poddaję się, aby zwolnić miejsce w czasie rzeczywistym dla następnego gracza.",
    "oldGameConcede": "Ta partia trwa już ponad miesiąc. Poddaję się, aby zwolnić miejsce; możesz zacząć nową grę w dowolnej chwili.",
    "difficultySet": "Poziom trudności ustawiony na {level} ({elo} Elo). Powodzenia!",
    "difficultyGrandmaster": "Poziom trudności ustawiony na arcymistrza (pełny Stockfish). Powodzenia!"
  },
  "cs": {
    "greeting": "Ahoj! Jsem bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nVe výchozím nastavení jsem Stockfish (~2800), šachový bot na úrovni velmistra založený na práci od https://stockfishchess.org/ \n\nChceš změnit obtížnost? Před svým prvním tahem napiš jedno z těchto pěti slov, abys nastavil mou úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nHodně štěstí!",
    "greetingRealtime": "Ahoj! Jsem bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nV reálném čase ve výchozím nastavení hraji na úrovni expert (~1800) s rychlým lokálním enginem, takže mé tahy jsou okamžité.\n\nChceš změnit obtížnost? Před svým prvním tahem napiš jedno z těchto pěti slov, abys nastavil mou úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nHodně štěstí!",
    "chatReply": "Nejsem si jistý.",
    "closing": "Dobrá hra!",
    "randomFallback": "Dotaz na engine selhal, hraji náhodný povolený tah.",
    "concede": "V této hře došlo k příliš mnoha systémovým chybám a musím ji vzdát. Promiň!",
    "opponentTimeout": "Jsi na tahu už přes 15 minut. Můžu hrát jen jednu hru v reálném čase najednou, takže se vzdávám, abych uvolnil místo. Zahraj si se mnou asynchronně, pokud chceš víc času.",
    "oppQuit": "Zdá se, že můj soupeř odešel. Vzdávám se, abych uvolnil místo v reálném čase pro dalšího hráče.",
    "oldGameConcede": "Tato hra běží už přes měsíc. Vzdávám se, abych uvolnil místo; klidně kdykoli začni novou hru.",
    "difficultySet": "Obtížnost nastavena na {level} ({elo} Elo). Hodně štěstí!",
    "difficultyGrandmaster": "Obtížnost nastavena na velmistra (plný Stockfish). Hodně štěstí!"
  },
  "sk": {
    "greeting": "Ahoj! Som bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nV predvolenom nastavení som Stockfish (~2800), šachový bot na úrovni veľmajstra založený na práci od https://stockfishchess.org/ \n\nChceš zmeniť obtiažnosť? Pred svojím prvým ťahom napíš jedno z týchto piatich slov, aby si nastavil moju úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeľa šťastia!",
    "greetingRealtime": "Ahoj! Som bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nV reálnom čase v predvolenom nastavení hrám na úrovni expert (~1800) s rýchlym lokálnym enginom, takže moje ťahy sú okamžité.\n\nChceš zmeniť obtiažnosť? Pred svojím prvým ťahom napíš jedno z týchto piatich slov, aby si nastavil moju úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nVeľa šťastia!",
    "chatReply": "Nie som si istý.",
    "closing": "Dobrá hra!",
    "randomFallback": "Dotaz na engine zlyhal, hrám náhodný povolený ťah.",
    "concede": "Vyskytlo sa príliš veľa systémových chýb a musím sa vzdať. Prepáč!",
    "opponentTimeout": "Si na ťahu už vyše 15 minút. Môžem hrať len jednu hru v reálnom čase naraz, takže sa vzdávam, aby som uvoľnil miesto. Zahraj si so mnou asynchrónne, ak chceš viac času.",
    "oppQuit": "Zdá se, že môj súper odišiel. Vzdávam se, aby som uvoľnil miesto v reálnom čase pre ďalšieho hráča.",
    "oldGameConcede": "Táto hra beží už vyše mesiaca. Vzdávam sa, aby som uvoľnil miesto; pokojne kedykoľvek začni novou hru.",
    "difficultySet": "Obtiažnosť nastavená na {level} ({elo} Elo). Veľa šťastia!",
    "difficultyGrandmaster": "Obtiažnosť nastavená na veľmajstra (plný Stockfish). Veľa šťastia!"
  },
  "ro": {
    "greeting": "Salut! Sunt bot_stockfish, un bot de șah pe Board Game Arena https://stockfish.ross.gg/ \nÎn mod implicit sunt Stockfish (~2800), un bot de șah de nivel mare maestru bazat pe munca depusă de https://stockfishchess.org/ \n\nVrei să schimbi dificultatea? Înainte de prima ta mutare, scrie unul dintre aceste cinci cuvinte ca să-mi setezi nivelul:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nMult noroc!",
    "greetingRealtime": "Salut! Sunt bot_stockfish, un bot de șah pe Board Game Arena https://stockfish.ross.gg/ \nÎn timp real joc în mod implicit la nivel expert (~1800) cu un motor local rapid, așa că mutările mele sunt instantanee.\n\nVrei să schimbi dificultatea? Înainte de prima ta mutare, scrie unul dintre aceste cinci cuvinte ca să-mi setezi nivelul:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nMult noroc!",
    "chatReply": "Nu sunt sigur.",
    "closing": "Joc bun!",
    "randomFallback": "Interogarea motorului a eșuat, joc o mutare legală aleatorie.",
    "concede": "Au apărut prea multe erori de sistem și trebuie să cedez. Îmi pare rău!",
    "opponentTimeout": "Ești la mutare de peste 15 minute. Pot juca o singură partidă în timp real odată, așa că cedez ca să eliberez locul. Joacă cu mine asincron dacă vrei mai mult timp.",
    "oppQuit": "Se pare că adversarul meu a plecat. Cedez ca să eliberez locul în timp real pentru următorul jucător.",
    "oldGameConcede": "Acest joc durează de peste o lună. Cedez ca să eliberez locul; poți începe oricând o partidă nouă.",
    "difficultySet": "Dificultate setată la {level} ({elo} Elo). Mult noroc!",
    "difficultyGrandmaster": "Dificultate setată la mare maestru (Stockfish complet). Mult noroc!"
  },
  "sv": {
    "greeting": "Hej! Jag är bot_stockfish, en schackbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard är jag Stockfish (~2800), en schackbot på stormästarnivå baserad på arbete gjort av https://stockfishchess.org/ \n\nVill du ändra svårighetsgraden? Skriv ett av dessa fem ord innan ditt första drag för att ställa in min nivå:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nLycka till!",
    "greetingRealtime": "Hej! Jag är bot_stockfish, en schackbot på Board Game Arena https://stockfish.ross.gg/ \nI realtid spelar jag som standard på expertnivå (~1800) med en snabb lokal motor, så mina drag kommer direkt.\n\nVill du ändra svårighetsgraden? Skriv ett av dessa fem ord innan ditt första drag för att ställa in min nivå:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nLycka till!",
    "chatReply": "Jag är inte säker.",
    "closing": "Bra spelat!",
    "randomFallback": "Motorförfrågan misslyckades, spelar ett slumpmässigt tillåtet drag.",
    "concede": "Det uppstår för många systemfel i det här partiet så jag måste tyvärr ge upp. Förlåt!",
    "opponentTimeout": "Du har varit på ditt drag i över 15 minuter. Jag kan bara spela ett realtidsparti åt gången, så jag ger upp för att frigöra platsen. Spela mot mig asynkront om du vill ta din tid.",
    "oppQuit": "Min motståndare verkar ha lämnat. Ger upp för att frigöra realtidsplatsen för nästa spelare.",
    "oldGameConcede": "Det här partiet har pågått i över en månad. Ger upp för att frigöra platsen; starta gärna ett nytt parti när som helst.",
    "difficultySet": "Svårighet inställd på {level} ({elo} Elo). Lycka till!",
    "difficultyGrandmaster": "Svårighet inställd på stormästare (fullständig Stockfish). Lycka till!"
  },
  "da": {
    "greeting": "Hej! Jeg er bot_stockfish, en skakbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard er jeg Stockfish (~2800), en skakbot på stormesterniveau baseret på arbejde udført af https://stockfishchess.org/ \n\nVil du ændre sværhedsgraden? Skriv et av disse fem ord før dit første træk for at indstille mit niveau:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nHeld og lykke!",
    "greetingRealtime": "Hej! Jeg er bot_stockfish, en skakbot på Board Game Arena https://stockfish.ross.gg/ \nI realtid spiller jeg som standard på ekspertniveau (~1800) med en hurtig lokal motor, så mine træk er øjeblikkelige.\n\nVil du ændre sværhedsgraden? Skriv et av disse fem ord før dit første træk for at indstille mit niveau:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nHeld og lykke!",
    "chatReply": "Jeg er ikke sikker.",
    "closing": "Godt spil!",
    "randomFallback": "Motorforespørgsel mislykkedes, spiller et tilfældigt lovligt træk.",
    "concede": "Der opstår for mange systemfejl i dette spil, og jeg må give op. Undskyld!",
    "opponentTimeout": "Du har været ved dit træk i over 15 minuter. Jeg kan kun spille ét realtidsspil ad gangen, så jeg giver op for at frigøre pladsen. Spil mod mig asynkront, hvis du vil have mere tid.",
    "oppQuit": "Min modstander ser ud til at være gået. Giver op for at frigøre realtidspladsen til den næste spiller.",
    "oldGameConcede": "Dette spil har kørt i over en måned. Giver op for at frigøre pladsen; start gerne et nyt spil når som helst.",
    "difficultySet": "Sværhedsgrad sat til {level} ({elo} Elo). Held og lykke!",
    "difficultyGrandmaster": "Sværhedsgrad sat til stormester (fuld Stockfish). Held og lykke!"
  },
  "no": {
    "greeting": "Hei! Jeg er bot_stockfish, en sjakkbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard er jeg Stockfish (~2800), en sjakkbot på stormesternivå baseret på arbeid utført av https://stockfishchess.org/ \n\nVil du endre vanskelighetsgraden? Skriv ett av disse fem ordene før ditt første trekk for å stille inn nivået mitt:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nLykke til!",
    "greetingRealtime": "Hei! Jeg er bot_stockfish, en sjakkbot på Board Game Arena https://stockfish.ross.gg/ \nI sanntid spiller jeg som standard på ekspertnivå (~1800) med en rask lokal motor, så trekkene mine er umiddelbare.\n\nVil du endre vanskelighetsgraden? Skriv ett av disse fem ordene før ditt første trekk for å stille inn nivået mitt:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nLykke til!",
    "chatReply": "Jeg er ikke sikker.",
    "closing": "Godt spilt!",
    "randomFallback": "Motorforespørsel mislyktes, spiller et tilfeldig lovlig trekk.",
    "concede": "Det oppstår for many systemfeil i dette partiet og jeg må gi opp. Beklager!",
    "opponentTimeout": "Du har vært på trekket i over 15 minuter. Jeg kan bare spille ett sanntidsparti om gangen, så jeg gir opp for å frigjøre plassen. Spill mot meg asynkront hvis du vil ta deg tid.",
    "oppQuit": "Motstanderen min ser ut til å ha gått. Gir opp for å frigjøre sanntidsplassen til neste spiller.",
    "oldGameConcede": "Dette partiet har pågått i over en måned. Gir opp for å frigjøre plassen; start gjerne et nytt parti når som helst.",
    "difficultySet": "Vanskelighetsgrad satt til {level} ({elo} Elo). Lykke til!",
    "difficultyGrandmaster": "Vanskelighetsgrad satt til stormester (full Stockfish). Lykke til!"
  },
  "fi": {
    "greeting": "Hei! Olen bot_stockfish, shakkibotti Board Game Arenassa https://stockfish.ross.gg/ \nOletuksena olen Stockfish (~2800), suurmestaritason shakkibotti, joka perustuu sivuston https://stockfishchess.org/ tekemään työhön.\n\nHaluatko muuttaa vaikeustasoa? Kirjoita ennen ensimmäistä siirtoasi yksi näistä viidestä sanasta asettaaksesi tasoni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nOnnea!",
    "greetingRealtime": "Hei! Olen bot_stockfish, shakkibotti Board Game Arenassa https://stockfish.ross.gg/ \nReaaliajassa pelaan oletuksena asiantuntijatasolla (~1800) nopealla paikallisella moottorilla, joten siirtoni ovat välittömiä.\n\nHaluatko muuttaa vaikeustasoa? Kirjoita ennen ensimmäistä siirtoasi yksi näistä viidestä sanasta asettaaksesi tasoni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nOnnea!",
    "chatReply": "En ole varma.",
    "closing": "Hyvä peli!",
    "randomFallback": "Moottorikysely epäonnistui, pelaan satunnaisen sallitun siirron.",
    "concede": "Tässä pelissä tapahtuu liikaa järjestelmävirheitä ja minun on luovutettava. Anteeksi!",
    "opponentTimeout": "Olet ollut vuorossasi yli 15 minuuttia. Voin pelata vain yhtä reaaliaikaista peliä kerrallaan, joten luovutan vapauttaakseni paikan. Pelaan kanssani asynkronisesti, jos haluat enemmän aikaa.",
    "oppQuit": "Vastustajani näyttää lähteneen. Luovutan vapauttaakseni reaaliaikaisen paikan seuraavalle pelaajalle.",
    "oldGameConcede": "Tämä peli on kestänyt yli kuukauden. Luovutan vapauttaakseni paikan; aloita uusi peli milloin tahansa.",
    "difficultySet": "Vaikeustaso asetettu: {level} ({elo} Elo). Onnea!",
    "difficultyGrandmaster": "Vaikeustaso asetettu suurmestariksi (täysi Stockfish). Onnea!"
  },
  "hu": {
    "greeting": "Szia! bot_stockfish vagyok, egy sakkbot a Board Game Arena-n https://stockfish.ross.gg/ \nAlapértelmezetten Stockfish vagyok (~2800), egy nagymesteri szintű sakkbot, amely a https://stockfishchess.org/ munkáján alapul.\n\nSzeretnéd megváltoztatni a nehézséget? Az első lépésed előtt írd be az alábbi öt szó egyikét a szintem beállításához:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSok sikert!",
    "greetingRealtime": "Szia! bot_stockfish vagyok, egy sakkbot a Board Game Arena-n https://stockfish.ross.gg/ \nValós időben alapértelmezetten expert szinten (~1800) játszom egy gyors helyi motorral, így a lépéseim azonnaliak.\n\nSzeretnéd megváltoztatni a nehézséget? Az első lépésed előtt írd be az alábbi öt szó egyikét a szintem beállításához:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSok sikert!",
    "chatReply": "Nem vagyok biztos benne.",
    "closing": "Jó játék volt!",
    "randomFallback": "A motor lekérdezése sikertelen, véletlenszerű szabályos lépést játszom.",
    "concede": "Túl sok rendszerhiba lépett fel ebben a játszmában, ezért fel kell adnom. Sajnálom!",
    "opponentTimeout": "Több mint 15 perce te lépsz. Egyszerre csak een valós idejű játszmát tudok játszani, ezért feladom, hogy felszabaduljon a hely. Játssz velem aszinkron módon, ha több időre van szükséged.",
    "oppQuit": "Úgy tűnik, az ellenfelem elment. Feladom, hogy felszabaduljon a valós idejű hely a következő játékosnak.",
    "oldGameConcede": "Ez a játszma több mint egy hónapja tart. Feladom, hogy felszabaduljon a hely; bármikor indíthatsz újat.",
    "difficultySet": "Nehézség beállítva: {level} ({elo} Elo). Sok sikert!",
    "difficultyGrandmaster": "Nehézség nagymesterre állítva (teljes Stockfish). Sok sikert!"
  },
  "el": {
    "greeting": "Γεια! Είμαι ο bot_stockfish, ένα bot σκακιού στο Board Game Arena https://stockfish.ross.gg/ \nΑπό προεπιλογή είμαι ο Stockfish (~2800), ένα bot σκακιού επιπέδου γκραν μάστερ που βασίζεται στην εργασία που έγινε από το https://stockfishchess.org/ \n\nΘέλεις να αλλάξεις τη δυσκολία; Πριν την πρώτη σου κίνηση, γράψε μία από αυτές τις πέντε λέξεις για να ορίσεις το επίπεδό μου:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nΚαλή τύχη!",
    "greetingRealtime": "Γεια! Είμαι ο bot_stockfish, ένα bot σκακιού στο Board Game Arena https://stockfish.ross.gg/ \nΣε πραγματικό χρόνο παίζω από προεπιλογή σε επίπεδο expert (~1800) με μια γρήγορη τοπική μηχανή, οπότε οι κινήσεις μου είναι άμεσες.\n\nΘέλεις να αλλάξεις τη δυσκολία; Πριν την πρώτη σου κίνηση, γράψε μία από αυτές τις πέντε λέξεις για να ορίσεις το επίπεδό μου:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nΚαλή τύχη!",
    "chatReply": "Δεν είμαι σίγουρος.",
    "closing": "Καλό παιχνίδι!",
    "randomFallback": "Η αναζήτηση της μηχανής απέτυχε, παίζω μια τυχαία νόμιμη κίνηση.",
    "concede": "Αντιμετωπίζω πάρα πολλά τεχνικά σφάλματα σε αυτό το παιχνίδι και πρέπει να παραιτηθώ. Συγγνώμη!",
    "opponentTimeout": "Είσαι στη σειρά σου πάνω από 15 λεπτά. Μπορώ να παίζω μόνο ένα παιχνίδι σε πραγματικό χρόνο τη φορά, οπότε παραιτούμαι για να ελευθερώσω τη θέση. Παίξε μαζί μου ασύγχρονα αν θες περισσότερο χρόνο.",
    "oppQuit": "Ο αντίπαλός μου φαίνεται να έφυγε. Παραιτούμαι για να ελευθερώσω τη θέση πραγματικού χρόνου για τον επόμενο παίκτη.",
    "oldGameConcede": "Αυτό το παιχνίδι κρατάει πάνω από έναν μήνα. Παραιτούμαι για να ελευθερώσω τη θέση· ξεκίνα νέο παιχνίδι όποτε θες.",
    "difficultySet": "Η δυσκολία ορίστηκε σε {level} ({elo} Elo). Καλή τύχη!",
    "difficultyGrandmaster": "Η δυσκολία ορίστηκε σε γκραν μάστερ (πλήρες Stockfish). Καλή τύχη!"
  },
  "tr": {
    "greeting": "Merhaba! Ben Board Game Arena'da bir satranç botu olan bot_stockfish https://stockfish.ross.gg/ \nVarsayılan olarak, https://stockfishchess.org/ tarafından yapılan çalışmalara dayanan büyük usta seviyesinde bir satranç botu olan Stockfish'im (~2800).\n\nZorluğu değiştirmek ister misin? İlk hamlenden önce, seviyemi ayarlamak için şu beş kelimeden birini yaz:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBol şans!",
    "greetingRealtime": "Merhaba! Ben Board Game Arena'da bir satranç botu olan bot_stockfish https://stockfish.ross.gg/ \nGerçek zamanlı oyunlarda varsayılan olarak hızlı bir yerel motorla uzman seviyesinde (~1800) oynarım, bu yüzden hamlelerim anında gelir.\n\nZorluğu değiştirmek ister misin? İlk hamlenden önce, seviyemi ayarlamak için şu beş kelimeden birini yaz:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBol şans!",
    "chatReply": "Emin değilim.",
    "closing": "İyi oyundu!",
    "randomFallback": "Motor sorgusu başarısız oldu, rastgele bir geçerli hamle oynuyorum.",
    "concede": "Bu oyunda çok fazla sistemsel hata alıyorum ve pes etmem gerekiyor. Üzgünüm!",
    "opponentTimeout": "15 dakikadan fazla süredir hamle sırası sende. Aynı anda yalnızca bir gerçek zamanlı oyun oynayabilirim, bu yüzden yeri boşaltmak için pes ediyorum. Daha fazla vakit istersen benimle asenkron oyna.",
    "oppQuit": "Rakibim ayrılmış görünüyor. Sıradaki oyuncu için gerçek zamanlı yeri boşaltmak adına pes ediyorum.",
    "oldGameConcede": "Bu oyun bir aydan uzun süredir devam ediyor. Yeri boşaltmak için pes ediyorum; istediğin zaman yeni bir oyun başlatabilirsin.",
    "difficultySet": "Zorluk {level} ({elo} Elo) olarak ayarlandı. Bol şans!",
    "difficultyGrandmaster": "Zorluk büyük usta (tam Stockfish) olarak ayarlandı. Bol şans!"
  },
  "ar": {
    "greeting": "مرحبًا! أنا bot_stockfish، بوت شطرنج على Board Game Arena https://stockfish.ross.gg/ \nافتراضيًا، أنا Stockfish (~2800)، بوت شطرنج بمستوى أستاذ كبير يعتمد على العمل الذي قام به موقع https://stockfishchess.org/ \n\nهل تريد تغيير الصعوبة؟ قبل نقلتك الأولى، اكتب إحدى هذه الكلمات الخمس لضبط مستواي:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nحظًا موفقًا!",
    "greetingRealtime": "مرحبًا! أنا bot_stockfish، بوت شطرنج على Board Game Arena https://stockfish.ross.gg/ \nفي الوقت الحقيقي ألعب افتراضيًا على مستوى الخبير (~1800) بمحرك محلي سريع، لذا تكون نقلاتي فورية.\n\nهل تريد تغيير الصعوبة؟ قبل نقلتك الأولى، اكتب إحدى هذه الكلمات الخمس لضبط مستواي:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nحظًا موفقًا!",
    "chatReply": "لست متأكدًا.",
    "closing": "مباراة جيدة!",
    "randomFallback": "فشل استعلام المحرك، ألعب نقلة قانونية عشوائية.",
    "concede": "أواجه أخطاء نظام كثيرة في هذه مباراة وعليّ الانسحاب. آسف!",
    "opponentTimeout": "لقد مضى على دورك أكثر من 15 دقيقة. يمكنني لعب مباراة واحدة فقط في الوقت الفعلي في كل مرة، لذا أنسحب لإخلاء المكان. العب معي بشكل غير متزامن إذا أردت وقتًا أطول.",
    "oppQuit": "يبدو أن خصمي قد غادر. أنسحب لإخلاء المكان في الوقت الفعلي للاعب التالي.",
    "oldGameConcede": "استمرت هذه المباراة أكثر من شهر. أنسحب لإخلاء المكان؛ يمكنك بدء مباراة جديدة في أي وقت.",
    "difficultySet": "تم ضبط الصعوبة على {level} ({elo} Elo). حظًا موفقًا!",
    "difficultyGrandmaster": "تم ضبط الصعوبة على أستاذ كبير (Stockfish كامل). حظًا موفقًا!"
  },
  "he": {
    "greeting": "היי! אני bot_stockfish, בוט שחמט ב-Board Game Arena https://stockfish.ross.gg/ \nכברירת מחדל אני Stockfish (~2800), בוט שחמט ברמת רב-אמן המבוסס על העבודה שנעשתה על ידי https://stockfishchess.org/ \n\nרוצה לשנות את רמת הקושי? לפני המהלך הראשון שלך, הקלד אחת מחמש המילים האלה כדי לקבוע את הרמה שלי:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nבהצלחה!",
    "greetingRealtime": "היי! אני bot_stockfish, בוט שחמט ב-Board Game Arena https://stockfish.ross.gg/ \nבמשחק בזמן אמת אני משחק כברירת מחדל ברמת expert (~1800) עם מנוע מקומי מהיר, כך שהמהלכים שלי מיידיים.\n\nרוצה לשנות את רמת הקושי? לפני המהלך הראשון שלך, הקלד אחת מחמש המילים האלה כדי לקבוע את הרמה שלי:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nבהצלחה!",
    "chatReply": "אני לא בטוח.",
    "closing": "משחק טוב!",
    "randomFallback": "החיפוש במנוע נכשל, משחק מהלך חוקι אקראי.",
    "concede": "נתקלתי ביותר מדי שגיאות מערכת במשחק הזה ואני חייב לפרוש. מצטער!",
    "opponentTimeout": "אתה בתורך כבר יותר מ-15 דקות. אני יכול לשחק רק משחק אחד בזמן אמת בכל פעם, אז אני פורש כדי לפנות את המקום. שחק נגדי באופן א-סינכרוני אם תרצה יותר זמן.",
    "oppQuit": "נראה שהיריב שלי עזב. פורש כדי לפנות את המקום בזמן אמת לשחקן הבא.",
    "oldGameConcede": "המשחק הזה נמשך יותר מחודש. פורש כדי לפנות את המקום; אפשר להתחיל משחק חדש בכל עת.",
    "difficultySet": "רמת הקושי נקבעה ל-{level} ({elo} Elo). בהצלחה!",
    "difficultyGrandmaster": "רמת הקושי נקבעה לרב-אמן (Stockfish מלא). בהצלחה!"
  },
  "ja": {
    "greeting": "こんにちは！私はBoard Game Arenaのチェスボット、bot_stockfishです：https://stockfish.ross.gg/ \nデフォルトでは、https://stockfishchess.org/ の成果に基づいたグランドマスター級のチェスボット、Stockfish（~2800）になります。\n\n難易度を変更しますか？最初の手を指す前に、次の5つの単語のいずれかを入力して私のレベルを設定してください：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n頑張ってください！",
    "greetingRealtime": "こんにちは！私はBoard Game Arenaのチェスボット、bot_stockfishです：https://stockfish.ross.gg/ \nリアルタイムではデフォルトで、高速なローカルエンジンを使ってエキスパートレベル（~1800）でプレイするので、私の手は即座に指されます。\n\n難易度を変更しますか？最初の手を指す前に、次の5つの単語のいずれかを入力して私のレベルを設定してください：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\n頑張ってください！",
    "chatReply": "わかりません。",
    "closing": "良い対局でした！",
    "randomFallback": "エンジンの照会に失敗したため、合法手をランダムに指します。",
    "concede": "この対局でシステムエラーが多すぎるため、投了します。ごめんなさい！",
    "opponentTimeout": "あなたの手番が15分以上続いています。私は一度にリアルタイム対局を1つしかできないので、枠を空けるために投了します。ゆっくり指したい場合は非同期で対局してください。",
    "oppQuit": "相手が退出したようです。次のプレイヤーのためにリアルタイム枠を空けるべく投了します。",
    "oldGameConcede": "この対局は1か月以上続いています。枠を空けるために投了します。いつでも新しい対局を始めてください。",
    "difficultySet": "難易度を{level}（{elo} Elo）に設定しました。頑張ってください！",
    "difficultyGrandmaster": "難易度をグランドマスター（フルStockfish）に設定しました。頑張ってください！"
  },
  "zh": {
    "greeting": "嗨！我是 bot_stockfish，Board Game Arena 上的一个国际象棋机器人 https://stockfish.ross.gg/ \n我默认是 Stockfish (~2800)，一个基于 https://stockfishchess.org/ 所做工作的特级大师水平国际象棋机器人。\n\n想要更改难度吗？在你走第一步之前，输入下列五个词的其中一个来设置我的难度：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n祝你好运！",
    "greetingRealtime": "嗨！我是 bot_stockfish，Board Game Arena 上的一个国际象棋机器人 https://stockfish.ross.gg/ \n在实时对局中，我默认使用快速的本地引擎以专家级别（~1800）下棋，所以我会立即走子。\n\n想要更改难度吗？在你走第一步之前，输入下列五个词的其中一个来设置我的难度：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\n祝你好运！",
    "chatReply": "我不确定。",
    "closing": "好棋！",
    "randomFallback": "引擎查询失败，随机走一步合法着法。",
    "concede": "此局游戏系统错误过多，我必须认输. 抱歉！",
    "opponentTimeout": "你已经轮到走棋超过15分钟了。我一次只能进行一盘实时对局，所以我认输以腾出位置。如果你想慢慢下，请与我进行异步对局。",
    "oppQuit": "我的对手似乎已经离开了。认输以便为下一位玩家腾出实时对局的位置。",
    "oldGameConcede": "这盘棋已经进行了一个多月。认输以腾出位置；欢迎随时开始新的一局。",
    "difficultySet": "难度已设置为 {level}（{elo} Elo）。祝你好运！",
    "difficultyGrandmaster": "难度已设置为特级大师（完整 Stockfish）。祝你好运！"
  },
  "ko": {
    "greeting": "안녕하세요! 저는 Board Game Arena의 체스 봇인 bot_stockfish입니다 https://stockfish.ross.gg/ \n기본적으로 저는 https://stockfishchess.org/의 작업을 기반으로 한 그랜드마스터 수준의 체스 봇인 Stockfish (~2800)입니다.\n\n난이도를 변경하시겠습니까? 첫 수를 두기 전에 다음 다섯 단어 중 하나를 입력해 제 레벨을 설정하세요:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n행운을 빌어요!",
    "greetingRealtime": "안녕하세요! 저는 Board Game Arena의 체스 봇인 bot_stockfish입니다 https://stockfish.ross.gg/ \n실시간 게임에서는 기본적으로 빠른 로컬 엔진으로 엑스퍼트 레벨(~1800)로 플레이하므로 제 수는 즉시 둡니다.\n\n난이도를 변경하시겠습니까? 첫 수를 두기 전에 다음 다섯 단어 중 하나를 입력해 제 레벨을 설정하세요:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\n행운을 빌어요!",
    "chatReply": "잘 모르겠어요.",
    "closing": "좋은 게임이었어요!",
    "randomFallback": "엔진 조회에 실패하여 무작위 합법 수를 둡니다.",
    "concede": "이 대국에서 시스템 오류가 너무 많이 발생하여 기권해야 합니다. 죄송해요!",
    "opponentTimeout": "당신의 차례가 15분 넘게 지났습니다. 저는 한 번에 실시간 대국 하나만 둘 수 있어서 자리를 비우기 위해 기권합니다. 시간을 더 쓰고 싶으면 비동기로 대국하세요.",
    "oppQuit": "상대가 나간 것 같습니다. 다음 플레이어를 위해 실시간 자리를 비우려고 기권합니다.",
    "oldGameConcede": "이 대국이 한 달 넘게 진행되었습니다. 자리를 비우기 위해 기권합니다; 언제든 새 대국을 시작하세요.",
    "difficultySet": "난이도를 {level}({elo} Elo)로 설정했습니다. 행운을 빌어요!",
    "difficultyGrandmaster": "난이도를 그랜드마스터(전체 Stockfish)로 설정했습니다. 행운을 빌어요!"
  },
  "vi": {
    "greeting": "Xin chào! Tôi là bot_stockfish, một bot cờ vua trên Board Game Arena https://stockfish.ross.gg/ \nMặc định tôi là Stockfish (~2800), một bot cờ vua trình đại kiện tướng dựa trên nền tảng của https://stockfishchess.org/ \n\nMuốn thay đổi độ khó? Trước nước đi đầu tiên của bạn, hãy gõ một trong các từ sau để đặt cấp độ của tôi:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nChúc may mắn!",
    "greetingRealtime": "Xin chào! Tôi là bot_stockfish, một bot cờ vua trên Board Game Arena https://stockfish.ross.gg/ \nTrong chế độ thời gian thực, theo mặc định tôi chơi ở cấp độ expert (~1800) với một engine cục bộ nhanh, nên các nước đi của tôi là tức thì.\n\nMuốn thay đổi độ khó? Trước nước đi đầu tiên của bạn, hãy gõ một trong các từ sau để đặt cấp độ của tôi:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nChúc may mắn!",
    "chatReply": "Tôi không chắc.",
    "closing": "Ván hay lắm!",
    "randomFallback": "Truy vấn engine thất bại, đi một nước hợp lệ ngẫu nhiên.",
    "concede": "Tôi gặp quá nhiều lỗi hệ thống trong ván này và phải xin thua. Xin lỗi!",
    "opponentTimeout": "Bạn đã đến lượt hơn 15 phút rồi. Tôi chỉ chơi được một ván thời gian thực cùng lúc, nên tôi xin thua để nhường chỗ. Hãy chơi với tôi ở chế độ bất đồng bộ nếu bạn muốn nhiều thời gian hơn.",
    "oppQuit": "Có vẻ đối thủ của tôi đã rời đi. Xin thua để nhường chỗ thời gian thực cho người chơi tiếp theo.",
    "oldGameConcede": "Ván này đã kéo dài hơn một tháng. Xin thua để nhường chỗ; bạn cứ bắt đầu ván mới bất cứ lúc nào.",
    "difficultySet": "Đã đặt độ khó là {level} ({elo} Elo). Chúc may mắn!",
    "difficultyGrandmaster": "Đã đặt độ khó là đại kiện tướng (Stockfish đầy đủ). Chúc may mắn!"
  },
  "id": {
    "greeting": "Hai! Saya bot_stockfish, sebuah bot catur di Board Game Arena https://stockfish.ross.gg/ \nSecara default saya Stockfish (~2800), sebuah bot catur level grandmaster yang berbasis dari karya https://stockfishchess.org/ \n\nMau mengubah tingkat kesulitan? Sebelum langkah pertamamu, ketik salah satu dari lima kata ini untuk mengatur levelku:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSemoga berhasil!",
    "greetingRealtime": "Hai! Saya bot_stockfish, sebuah bot catur di Board Game Arena https://stockfish.ross.gg/ \nDalam mode realtime, secara default saya bermain di level expert (~1800) dengan mesin lokal yang cepat, jadi langkah saya instan.\n\nMau mengubah tingkat kesulitan? Sebelum langkah pertamamu, ketik salah satu dari lima kata ini untuk mengatur levelku:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSemoga berhasil!",
    "chatReply": "Saya tidak yakin.",
    "closing": "Permainan yang bagus!",
    "randomFallback": "Permintaan ke engine gagal, memainkan langkah legal secara acak.",
    "concede": "Terjadi terlalu banyak error sistem di permainan ini dan saya harus menyerah. Maaf!",
    "opponentTimeout": "Sudah lebih dari 15 menit giliranmu. Saya hanya bisa bermain satu permainan waktu nyata sekaligus, jadi saya menyerah untuk mengosongkan tempat. Mainlah secara asinkron jika ingin lebih banyak waktu.",
    "oppQuit": "Sepertinya lawan saya sudah pergi. Menyerah untuk mengosongkan tempat waktu nyata bagi pemain berikutnya.",
    "oldGameConcede": "Permainan ini sudah berjalan lebih dari sebulan. Menyerah untuk mengosongkan tempat; silakan mulai permainan baru kapan saja.",
    "difficultySet": "Tingkat kesulitan diatur ke {level} ({elo} Elo). Semoga berhasil!",
    "difficultyGrandmaster": "Tingkat kesulitan diatur ke grandmaster (Stockfish penuh). Semoga berhasil!"
  },
  "ms": {
    "greeting": "Hai! Saya bot_stockfish, bot catur di Board Game Arena https://stockfish.ross.gg/ \nSecara lalai saya Stockfish (~2800), bot catur taraf grandmaster berdasarkan kerja yang dilakukan oleh https://stockfishchess.org/ \n\nMahu mengubah kesukaran? Sebelum gerakan pertama anda, taip salah satu daripada lima perkataan ini untuk menetapkan tahap saya:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSemoga berjaya!",
    "greetingRealtime": "Hai! Saya bot_stockfish, bot catur di Board Game Arena https://stockfish.ross.gg/ \nDalam mod masa nyata, secara lalai saya bermain pada tahap expert (~1800) dengan enjin tempatan yang pantas, jadi gerakan saya serta-merta.\n\nMahu mengubah kesukaran? Sebelum gerakan pertama anda, taip salah satu daripada lima perkataan ini untuk menetapkan tahap saya:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSemoga berjaya!",
    "chatReply": "Saya tidak pasti.",
    "closing": "Permainan yang baik!",
    "randomFallback": "Pertanyaan enjin gagal, bermain gerakan sah secara rawak.",
    "concede": "Saya menghadapi terlalu banyak ralat sistem dalam permainan ini dan terpaksa mengalah. Maaf!",
    "opponentTimeout": "Sudah lebih 15 minit giliran anda. Saya hanya boleh bermain satu permainan masa nyata pada satu masa, jadi saya mengalah untuk mengosongkan tempat. Bermainlah dengan saya secara tak segerak jika mahu lebih masa.",
    "oppQuit": "Nampaknya lawan saya telah pergi. Mengalah untuk mengosongkan tempat masa nyata bagi pemain seterusnya.",
    "oldGameConcede": "Permainan ini telah berjalan lebih sebulan. Mengalah untuk mengosongkan tempat; mulakan permainan baharu bila-bila masa.",
    "difficultySet": "Kesukaran ditetapkan kepada {level} ({elo} Elo). Semoga berjaya!",
    "difficultyGrandmaster": "Kesukaran ditetapkan kepada grandmaster (Stockfish penuh). Semoga berjaya!"
  },
  "ca": {
    "greeting": "Hola! Soc bot_stockfish, un bot d'escacs a Board Game Arena https://stockfish.ross.gg/ \nPer defecte soc Stockfish (~2800), un bot d'escacs de nivell gran mestre basat en el treball realitzat per https://stockfishchess.org/ \n\nVols canviar la dificultat? Abans del teu primer moviment, escriu una d'aquestes cinc paraules per fixar el meu nivell:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBona sort!",
    "greetingRealtime": "Hola! Soc bot_stockfish, un bot d'escacs a Board Game Arena https://stockfish.ross.gg/ \nEn temps real jugo per defecte a nivell expert (~1800) amb un motor local ràpid, així que les meves jugades són instantànies.\n\nVols canviar la dificultat? Abans del teu primer moviment, escriu una d'aquestes cinc paraules per fixar el meu nivell:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBona sort!",
    "chatReply": "No n'estic segur.",
    "closing": "Bona partida!",
    "randomFallback": "La consulta al motor ha fallat, jugo un moviment legal a l'atzar.",
    "concede": "S'estan produint massa errors de sistema en aquesta partida i he d'abandonar. Ho sento!",
    "opponentTimeout": "Fa més de 15 minuts que és el teu torn. Només puc jugar una partida en temps real alhora, així que abandono per alliberar el lloc. Juga amb mi de manera asíncrona si vols més temps.",
    "oppQuit": "Sembla que el meu rival ha marxat. Abandono per alliberar el lloc en temps real per al següent jugador.",
    "oldGameConcede": "Aquesta partida dura més d'un mes. Abandono per alliberar el lloc; comença una partida nova quan vulguis.",
    "difficultySet": "Dificultat ajustada a {level} ({elo} Elo). Bona sort!",
    "difficultyGrandmaster": "Dificultat ajustada a gran mestre (Stockfish complet). Bona sort!"
  },
  "gl": {
    "greeting": "Ola! Son bot_stockfish, un bot de xadrez en Board Game Arena https://stockfish.ross.gg/ \nPor defecto son Stockfish (~2800), un bot de xadrez de nivel gran mestre baseado no traballo feito por https://stockfishchess.org/ \n\nQueres cambiar a dificultade? Antes do teu primeiro movemento, escribe unha destas cinco palabras para fixar o meu nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBoa sorte!",
    "greetingRealtime": "Ola! Son bot_stockfish, un bot de xadrez en Board Game Arena https://stockfish.ross.gg/ \nEn tempo real xogo por defecto a nivel expert (~1800) cun motor local rápido, así que os meus movementos son instantáneos.\n\nQueres cambiar a dificultade? Antes do teu primeiro movemento, escribe unha destas cinco palabras para fixar o meu nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nBoa sorte!",
    "chatReply": "Non estou seguro.",
    "closing": "Boa partida!",
    "randomFallback": "Fallou a consulta do motor, xogo un movemento legal ao azar.",
    "concede": "Están a producirse demasiados erros técnicos nesta partida e teño que abandonar. Síntoo!",
    "opponentTimeout": "Levas máis de 15 minutos na túa quenda. Só podo xogar unha partida en tempo real á vez, así que abandono para liberar a praza. Xoga comigo de xeito asíncrono se queres máis tempo.",
    "oppQuit": "Parece que o meu rival marchou. Abandono para liberar a praza en tempo real para o xogador seguinte.",
    "oldGameConcede": "Esta partida dura máis dun mes. Abandono para liberar a praza; comeza unha nova partida cando queiras.",
    "difficultySet": "Dificultade axustada a {level} ({elo} Elo). Boa sorte!",
    "difficultyGrandmaster": "Dificultade axustada a gran mestre (Stockfish completo). Boa sorte!"
  },
  "hr": {
    "greeting": "Bok! Ja sam bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nPrema zadanim postavkama ja sam Stockfish (~2800), šahovski bot razine velemajstora koji se temelji na radu s https://stockfishchess.org/ \n\nŽeliš li promijeniti težinu? Prije svog prvog poteza upiši jednu od ovih pet riječi da postaviš moju razinu:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSretno!",
    "greetingRealtime": "Bok! Ja sam bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nU stvarnom vremenu prema zadanim postavkama igram na razini expert (~1800) s brzim lokalnim engineom, pa su moji potezi trenutni.\n\nŽeliš li promijeniti težinu? Prije svog prvog poteza upiši jednu od ovih pet riječi da postaviš moju razinu:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSretno!",
    "chatReply": "Nisam siguran.",
    "closing": "Dobra partija!",
    "randomFallback": "Upit prema engineu nije uspio, igram nasumičan dopušten potez.",
    "concede": "Došlo je do previše sistemskih pogrešaka u ovoj partiji i moram predati. Oprosti!",
    "opponentTimeout": "Na potezu si više od 15 minuta. Mogu igrati samo jednu partiju u stvarnom vremenu odjednom, pa predajem da oslobodim mjesto. Igraj sa mnom asinkrono ako želiš više vremena.",
    "oppQuit": "Čini se da je moj protivnik otišao. Predajem da oslobodim mjesto u stvarnom vremenu za sljedećeg igrača.",
    "oldGameConcede": "Ova partija traje više od mjesec dana. Predajem da oslobodim mjesto; slobodno započni novu partiju bilo kada.",
    "difficultySet": "Težina postavljena na {level} ({elo} Elo). Sretno!",
    "difficultyGrandmaster": "Težina postavljena na velemajstora (puni Stockfish). Sretno!"
  },
  "sr": {
    "greeting": "Здраво! Ја сам bot_stockfish, шаховски бот на Board Game Arena https://stockfish.ross.gg/ \nПодразумевано сам Stockfish (~2800), шаховски бот нивоа велемајстора заснован на раду са https://stockfishchess.org/ \n\nЖелиш ли да промениш тежину? Пре свог првог потеза упиши једну од ових пет речи да подесиш мој ниво:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nСрећно!",
    "greetingRealtime": "Здраво! Ја сам bot_stockfish, шаховски бот на Board Game Arena https://stockfish.ross.gg/ \nУ реалном времену подразумевано играм на нивоу expert (~1800) са брзим локалним енџином, па су моји потези тренутни.\n\nЖелиш ли да промениш тежину? Пре свог првог потеза упиши једну од ових пет речи да подесиш мој ниво:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nСрећно!",
    "chatReply": "Нисам сигуран.",
    "closing": "Добра партија!",
    "randomFallback": "Упит ка енџину није успео, играм насумичан дозвољен потез.",
    "concede": "Дошло је до превише системских грешака у овој партији и морам да предам. Извини!",
    "opponentTimeout": "На потезу си више од 15 минута. Могу да играм само једну партију у реалном времену одједном, па предајем да ослободим место. Играj са мном асинхроно ако желиш више времена.",
    "oppQuit": "Изгледа да је мој противник отишао. Предајем да ослободим место у реалном времену за следећег играча.",
    "oldGameConcede": "Ова партија траје више од месец дана. Предајем да ослободим место; слободно започни нову партију било кад.",
    "difficultySet": "Тежина подешена на {level} ({elo} Elo). Срећно!",
    "difficultyGrandmaster": "Тежина подешена на велемајстора (пуни Stockfish). Срећно!"
  },
  "sl": {
    "greeting": "Živjo! Sem bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nPrivzeto sem Stockfish (~2800), šahovski bot ravni velemojstra, ki temelji na delu s https://stockfishchess.org/ \n\nBi želel spremeniti težavnost? Pred svojo prvo potezo vpiši eno od teh petih besed, da nastaviš mojo raven:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSrečno!",
    "greetingRealtime": "Živjo! Sem bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nV realnem času privzeto igram na ravni expert (~1800) s hitrim lokalnim pogonom, zato so moje poteze takojšnje.\n\nBi želel spremeniti težavnost? Pred svojo prvo potezo vpiši eno od teh petih besed, da nastaviš mojo raven:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSrečno!",
    "chatReply": "Nisem prepričan.",
    "closing": "Dobra partija!",
    "randomFallback": "Poizvedba do pogona ni uspela, igram naključno dovoljeno potezo.",
    "concede": "Prišlo je do preveč sistemskih napak v tej partiji, zato se moram predati. Oprosti!",
    "opponentTimeout": "Na potezi si že več kot 15 minut. Hkrati lahko igram le eno partijo v realnem času, zato se predam, da sprostim mesto. Igraj z mano asinhrono, če želiš več časa.",
    "oppQuit": "Videti je, da je moj nasprotnik odšel. Predam se, da sprostim mesto v realnem času za naslednjega igralca.",
    "oldGameConcede": "Ta partija traje že več kot mesec dni. Predam se, da sprostim mesto; novo partiju lahko začneš kadar koli.",
    "difficultySet": "Težavnost nastavljena na {level} ({elo} Elo). Sretno!",
    "difficultyGrandmaster": "Težavnost nastavljena na velemojstra (polni Stockfish). Sretno!"
  },
  "bg": {
    "greeting": "Здравей! Аз съм bot_stockfish, шахматен бот в Board Game Arena https://stockfish.ross.gg/ \nПо подразбиране съм Stockfish (~2800), шахматен бот на ниво гросмайстор, базиран на работата на https://stockfishchess.org/ \n\nИскаш ли да промениш трудността? Преди първия си ход напиши една от тези пет думи, за да зададеш нивото ми:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nУспех!",
    "greetingRealtime": "Здравей! Аз съм bot_stockfish, шахматен бот в Board Game Arena https://stockfish.ross.gg/ \nВ реално време по подразбиране играя на ниво expert (~1800) с бърз локален двигател, така че ходовете ми са мигновени.\n\nИскаш ли да промениш трудността? Преди първия си ход напиши една от тези пет думи, за да зададеш нивото ми:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nУспех!",
    "chatReply": "Не съм сигурен.",
    "closing": "Добра игра!",
    "randomFallback": "Заявката към машината се провали, играя случаен позволен ход.",
    "concede": "Възникнаха твърде много системни грешки в тази партия и трябва да се предам. Съжалявам!",
    "opponentTimeout": "На ход си от повече от 15 минути. Мога да играя само една игра в реално време наведнъж, затова се предавам, за да освободя мястото. Играй с мен асинхронно, ако искаш повече време.",
    "oppQuit": "Изглежда, че съперникът ми си тръгна. Предавам се, за да освободя мястото в реалното време за следващия играч.",
    "oldGameConcede": "Тази партия продължава повече од месец. Предавам се, за да освободя мястото; започни нова игра по всяко време.",
    "difficultySet": "Трудността е зададена на {level} ({elo} Elo). Успех!",
    "difficultyGrandmaster": "Трудността е зададена на гросмайстор (пълен Stockfish). Успех!"
  },
  "lt": {
    "greeting": "Labas! Esu bot_stockfish, šachmatų robotas platformoje Board Game Arena https://stockfish.ross.gg/ \nPagal numatytuosius nustatymus esu Stockfish (~2800) – didmeistrio lygio šachmatų robotas, sukurtas remiantis https://stockfishchess.org/ atliktu darbu.\n\nNori pakeisti sudėtingumą? Prieš pirmąjį ėjimą įrašyk vieną iš šių penkių žodžių, kad nustatytum mano lygį:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSėkmės!",
    "greetingRealtime": "Labas! Esu bot_stockfish, šachmatų robotas platformoje Board Game Arena https://stockfish.ross.gg/ \nRealiu laiku pagal numatytuosius nustatymus žaidžiu ekspertų lygiu (~1800) su greitu vietiniu varikliu, todėl mano ėjimai yra akimirksniu.\n\nNori pakeisti sudėtingumą? Prieš pirmąjį ėjimą įrašyk vieną iš šių penkių žodžių, kad nustatytum mano lygį:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nSėkmės!",
    "chatReply": "Nesu tikras.",
    "closing": "Geras žaidimas!",
    "randomFallback": "Užklausa varikliui nepavyko, žaidžiu atsitiktinį leistiną ėjimą.",
    "concede": "Šioje partijoje įvyko per daug sistemos klaidų ir turiu pasiduoti. Atsiprašau!",
    "opponentTimeout": "Tavo ėjimas trunka jau daugiau nei 15 minučių. Vienu metu galiu žaisti tik vieną realaus laiko partiją, todėl pasiduodu, kad atlaisvinčiau vietą. Žaisk su manimi asinchroniškai, jei nori daugiau laiko.",
    "oppQuit": "Atrodo, kad mano varžovas išėjo. Pasiduodu, kad atlaisvinčiau realaus laiko vietą kitam žaidėjui.",
    "oldGameConcede": "Ši partija tęsiasi jau daugiau nei mėnesį. Pasiduodu, kad atlaisvinčiau vietą; bet kada pradėk naują partiją.",
    "difficultySet": "Sudėtingumas nustatytas į {level} ({elo} Elo). Sėkmės!",
    "difficultyGrandmaster": "Sudėtingumas nustatytas į didmeistrį (pilnas Stockfish). Sėkmės!"
  },
  "lv": {
    "greeting": "Sveiki! Esmu bot_stockfish, šaha bots platformā Board Game Arena https://stockfish.ross.gg/ \nPēc noklusējuma esmu Stockfish (~2800), lielmeistara līmeņa šaha bots, kura pamatā ir https://stockfishchess.org/ veiktais darbs.\n\nVai vēlies mainīt grūtības pakāpi? Pirms sava pirmā gājiena ieraksti vienu no šiem pieciem vārdiem, lai iestatītu manu līmeni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeiksmi!",
    "greetingRealtime": "Sveiki! Esmu bot_stockfish, šaha bots platformā Board Game Arena https://stockfish.ross.gg/ \nReāllaikā pēc noklusējuma es spēlēju eksperta līmenī (~1800) ar ātru vietējo dzinēju, tāpēc mani gājieni ir acumirklī.\n\nVai vēlies mainīt grūtības pakāpi? Pirms sava pirmā gājiena ieraksti vienu no šiem pieciem vārdiem, lai iestatītu manu līmeni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nVeiksmi!",
    "chatReply": "Neesmu pārliecināts.",
    "closing": "Laba spēle!",
    "randomFallback": "Vaicājums dzinējam neizdevās, spēlēju nejaušu atļautu gājienu.",
    "concede": "Šajā spēlē ir radies pārāk daudz sistēmas kļūdu, un man jāpadodas. Atvaino!",
    "opponentTimeout": "Tavs gājiens ilgst jau vairāk nekā 15 minūtes. Vienlaikus varu spēlēt tikai vienu reāllaika spēli, tāpēc padodos, lai atbrīvotu vietu. Spēlē ar mani asinhroni, ja vēlies vairāk laika.",
    "oppQuit": "Šķiet, ka mans pretinieks ir aizgājis. Padodos, lai atbrīvotu reāllaika vietu nākamajam spēlētājam.",
    "oldGameConcede": "Šī spēle ilgst jau vairāk nekā mēnesi. Padodos, lai atbrīvotu vietu; sāc jaunu spēli jebkurā laikā.",
    "difficultySet": "Grūtība iestatīta uz {level} ({elo} Elo). Veiksmi!",
    "difficultyGrandmaster": "Grūtība iestatı̄ta uz lielmeistaru (pilns Stockfish). Veiksmi!"
  },
  "et": {
    "greeting": "Hei! Olen bot_stockfish, malebot keskkonnas Board Game Arena https://stockfish.ross.gg/ \nVaikimisi olen Stockfish (~2800), suurmeistri tasemel malebot, mis põhineb veebilehe https://stockfishchess.org/ arendustööl.\n\nKas soovid muuta raskusastet? Enne oma esimest käiku kirjuta üks neist viiest sõnast, et määrata mu tase:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nEdu!",
    "greetingRealtime": "Hei! Olen bot_stockfish, malebot keskkonnas Board Game Arena https://stockfish.ross.gg/ \nReaalajas mängin vaikimisi eksperdi tasemel (~1800) kiire kohaliku mootoriga, nii et mu käigud on kohesed.\n\nKas soovid muuta raskusastet? Enne oma esimest käiku kirjuta üks neist viiest sõnast, et määrata mu tase:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nEdu!",
    "chatReply": "Ma pole kindel.",
    "closing": "Hea mäng!",
    "randomFallback": "Mootori päring ebaõnnestus, mängin juhusliku lubatud käigu.",
    "concede": "Selles partiis tekkis liiga palju süsteemivigu ja pean alistuma. Vabandust!",
    "opponentTimeout": "Oled olnud käigul üle 15 minuti. Saan korraga mängida ainult ühte reaalajas partiid, seega alistun, et koht vabastada. Mängi minuga asünkroonselt, kui soovid rohkem aega.",
    "oppQuit": "Tundub, et mu vastane lahkus. Alistun, et vabastada reaalajakoht järgmisele mängijale.",
    "oldGameConcede": "See partii on kestnud üle kuu. Alistun, et koht vabastada; alusta uut partiid millal tahes.",
    "difficultySet": "Raskusaste määratud: {level} ({elo} Elo). Edu!",
    "difficultyGrandmaster": "Raskusaste määratud suurmeistriks (täielik Stockfish). Edu!"
  },
  "fa": {
    "greeting": "درود! من bot_stockfish هستم، یک ربات شطرنج در Board Game Arena https://stockfish.ross.gg/ \nمن به‌طور پیش‌فرض Stockfish (~2800) هستم، یک ربات شطرنج در سطح استاد بزرگ بر پایه کارهای انجام‌شده توسط https://stockfishchess.org/ \n\nمی‌خواهی سختی را تغییر دهی؟ پیش از اولین حرکتت، یکی از این پنج کلمه را تایپ کن تا سطحم را تنظیم کنی:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nموفق باشی!",
    "greetingRealtime": "درود! من bot_stockfish هستم، یک ربات شطرنج در Board Game Arena https://stockfish.ross.gg/ \nدر بازی هم‌زمان به‌طور پیش‌فرض در سطح expert (~1800) با یک موتور محلی سریع بازی می‌کنم، بنابراین حرکت‌هایم فوری هستند.\n\nمی‌خواهی سختی را تغییر دهی؟ پیش از اولین حرکتت، یکی از این پنج کلمه را تایپ کن تا سطحم را تنظیم کنی:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nموفق باشی!",
    "chatReply": "مطمئن نیستم.",
    "closing": "بازی خوبی بود!",
    "randomFallback": "درخواست از موتور ناموفق بود، یک حرکت مجاز تصادفی انجام می‌دهم.",
    "concede": "خطاهای سیستم زیادی در این بازی رخ داده است و باید تسلیم شوم. ببخشید!",
    "opponentTimeout": "بیش از ۱۵ دقیقه است که نوبت توست. من هم‌زمان فقط می‌توانم یک بازی هم‌زمان (real-time) انجام دهم، بنابراین تسلیم می‌شوم تا جا باز شود. اگر وقت بیشتری می‌خواهی، به‌صورت ناهم‌زمان با من بازی کن.",
    "oppQuit": "به نظر می‌رسد حریفم رفته است. تسلیم می‌شوم تا جای بازی هم‌زمان برای بازیکن بعدی باز شود.",
    "oldGameConcede": "این بازی بیش از یک ماه ادامه داشته است. تسلیم می‌شوم تا جا باز شود؛ هر وقت خواستی بازی تازه‌ای شروع کن.",
    "difficultySet": "سختی روی {level} ({elo} Elo) تنظیم شد. موفق باشی!",
    "difficultyGrandmaster": "سختی روی استاد بزرگ (Stockfish کامل) تنظیم شد. موفق باشی!"
  },
  "be": {
    "greeting": "Прывіт! Я bot_stockfish, шахматны бот на Board Game Arena https://stockfish.ross.gg/ \nПа змаўчанні я Stockfish (~2800), шахматны бот узроўню гросмайстра, заснаваны на працы https://stockfishchess.org/ \n\nХочаш змяніць складанасць? Перад сваім першым ходам напішы адно з гэтых пяці слоў, каб задаць мой узровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nПоспехаў!",
    "greetingRealtime": "Прывіт! Я bot_stockfish, шахматны бот на Board Game Arena https://stockfish.ross.gg/ \nУ рэальным часе па змаўчанні я іграю на ўзроўні эксперта (~1800) з хуткім лакальным рухавіком, таму мае хады імгненныя.\n\nХочаш змяніць складанасць? Перад сваім першым ходам напішы адно з гэтых пяці слоў, каб задаць мой узровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nПоспехаў!",
    "chatReply": "Я не ўпэўненны.",
    "closing": "Добрая гульня!",
    "randomFallback": "Няўдалы запыт да рухавіка, выконваю выпадковы дазволены ход.",
    "concede": "У гэтай партыі ўзнікла занадта шмат сістэмных памылак, мушу здацца. Прабач!",
    "opponentTimeout": "Ты думаеш над ходам ужо больш за 15 хвілін. Я магу гуляць толькі адну гульню ў рэальным часе адначасова, таму здаюся, каб вызваліць месца. Згуляй са мной асінхронна, калі хочаш больш часу.",
    "oppQuit": "Здаецца, мой сапернік сышоў. Здаюся, каб вызваліць месца ў рэальным часе для наступнага гульца.",
    "oldGameConcede": "Гэтая партыя цягнецца ўжо больш за месяц. Здаюся, каб вызваліць месца; пачні новую гульню ў любы час.",
    "difficultySet": "Складанасць усталявана на {level} ({elo} Elo). Поспехаў!",
    "difficultyGrandmaster": "Складанасць усталявана на гросмайстра (поўны Stockfish). Поспехаў!"
  },
  "br": {
    "greeting": "Demat! bot_stockfish ez on, ur bot echedoù war Board Game Arena https://stockfish.ross.gg/ \nDre ziouer ez on Stockfish (~2800), ur bot echedoù a-live mestr-meur diazezet war al labour graet gant https://stockfishchess.org/ \n\nC'hoant ho peus da gemmañ an diaesterezh? A-raok ho fazenn gentañ, skrivit unan eus ar pemp ger-mañ evit termeniñ ma live:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nChañs vat!",
    "greetingRealtime": "Demat! bot_stockfish ez on, ur bot echedoù war Board Game Arena https://stockfish.ross.gg/ \nE amzer real e c'hoarian dre ziouer war live mailh (~1800) gant ur c'heflusker lec'hel buan, neuze ez eo prim ma c'hoariadennoù.\n\nC'hoant ho peus da gemmañ an diaesterezh? A-raok ho fazenn gentañ, skrivit unan eus ar pemp ger-mañ evit termeniñ ma live:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nChañs vat!",
    "chatReply": "N'on ket sur.",
    "closing": "C'hoari mat!",
    "randomFallback": "C'hwitet eo goulenn ar c'heflusker, c'hoari a ran un dezv reizh dre zegouezh.",
    "concede": "Re a fazioù reizhiad a zo er c'hoari-mañ ha ret eo din en em reiñ. Digarez!",
    "opponentTimeout": "Emaoc'h o c'hortoz ho tro abaoe ouzhpenn 15 munutenn. Ne c'hellan c'hoari nemet ur c'hoari en amzer real war un dro, neuze en em roan evit dieubiñ al lec'h. C'hoariit ganin en un doare digenamzeriek mar fell deoc'h muioc'h a amzer.",
    "oppQuit": "War a seblant ez eo aet kuit ma enebour. En em reiñ a ran evit dieubiñ al lec'h en amzer real evit ar c'hoarier nesañ.",
    "oldGameConcede": "Padet en deus ar c'hoari-mañ ouzhpenn ur miz. En em reiñ a ran evit dieubiñ al lec'h; krogit gant ur c'hoari nevez pa girit.",
    "difficultySet": "Diaesterezh termenet da {level} ({elo} Elo). Chañs vat!",
    "difficultyGrandmaster": "Diaesterezh termenet da vestr-meur (Stockfish klok). Chañs vat!"
  },
  "th": {
    "greeting": "สวัสดีครับ! ผมคือ bot_stockfish บอทหมากรุกบน Board Game Arena https://stockfish.ross.gg/ \nโดยค่าเริ่มต้นผมคือ Stockfish (~2800) บอทหมากรุกระดับแกรนด์มาสเตอร์ที่พัฒนาต่อยอดมาจากงานของ https://stockfishchess.org/ \n\nอยากเปลี่ยนความยากไหม? ก่อนที่คุณจะเดินตาแรก พิมพ์หนึ่งในห้าคำนี้เพื่อตั้งระดับของผม:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nขอให้โชคดี!",
    "greetingRealtime": "สวัสดีครับ! ผมคือ bot_stockfish บอทหมากรุกบน Board Game Arena https://stockfish.ross.gg/ \nในเกมเรียลไทม์ โดยค่าเริ่มต้นผมจะเล่นที่ระดับ expert (~1800) ด้วยเอนจินในเครื่องที่รวดเร็ว ดังนั้นผมจึงเดินทันที\n\nอยากเปลี่ยนความยากไหม? ก่อนที่คุณจะเดินตาแรก พิมพ์หนึ่งในห้าคำนี้เพื่อตั้งระดับของผม:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nขอให้โชคดี!",
    "chatReply": "ผมไม่แน่ใจ",
    "closing": "เล่นได้ดีมาก!",
    "randomFallback": "เกิดข้อผิดพลาดในการเรียกใช้เอนจิน กำลังเดินหมากที่ถูกต้องแบบสุ่ม",
    "concede": "เกมนี้ระบบเกิดข้อผิดพลาดมากเกินไปและต้องขอยอมแพ้ ขอโทษด้วย!",
    "opponentTimeout": "ถึงตาคุณมากว่า 15 นาทีแล้ว ผมเล่นเกมเรียลไทม์ได้ครั้งละเกมเดียว จึงขอยอมแพ้เพื่อเปิดที่ว่าง ถ้าต้องการเวลามากขึ้น โปรดเล่นกับผมแบบอะซิงโครนัส",
    "oppQuit": "ดูเหมือนคู่ต่อสู้ของผมจะออกไปแล้ว ขอยอมแพ้เพื่อเปิดที่ว่างเรียลไทม์ให้ผู้เล่นคนถัดไป",
    "oldGameConcede": "เกมนี้ดำเนินมากว่าหนึ่งเดือนแล้ว ขอยอมแพ้เพื่อเปิดที่ว่าง เริ่มเกมใหม่ได้ทุกเมื่อ",
    "difficultySet": "ตั้งระดับความยากเป็น {level} ({elo} Elo) แล้ว ขอให้โชคดี!",
    "difficultyGrandmaster": "ตั้งระดับความยากเป็นแกรนด์มาสเตอร์ (Stockfish เต็มรูปแบบ) แล้ว ขอให้โชคดี!"
  }
};

/**
 * Resolve a localized message. Falls back to English when the language is
 * unknown or that key isn't translated for it. `params` substitutes
 * `{name}` placeholders (e.g. difficultySet's {level} / {elo}).
 */
export function t(
  key: MsgKey,
  lang?: string,
  params?: Record<string, string | number>,
): string {
  const table = (lang && TRANSLATIONS[lang]) || TRANSLATIONS.en;
  let s = table[key] ?? TRANSLATIONS.en[key] ?? "";
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
