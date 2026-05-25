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
  | "chatReply"
  | "closing"
  | "randomFallback"
  | "concede"
  | "opponentTimeout"
  | "oppQuit"
  | "oldGameConcede"
  | "drawDecline"
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
    "greeting": "Hi! I'm bot_stockfish, a chess bot on Board Game Arena https://stockfish.ross.gg/ \nMy default is Stockfish (~2800), a grandmaster-strength chess bot based on work done by https://stockfishchess.org/ \n\nWant to change the difficulty? At any time, type one of these five words to set my level:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nGood luck!",
    "chatReply": "I'm not sure.",
    "closing": "Good game!",
    "randomFallback": "Engine lookup failed, playing a random legal move.",
    "concede": "I'm hitting too many errors in this game and have to concede. Sorry!",
    "opponentTimeout": "You've been on your turn for over 15 minutes. I can only play one realtime game at a time, so I'm conceding to free the slot. Please play me asynchronously if you'd like more time.",
    "oppQuit": "My opponent seems to have left. Conceding to free the realtime slot for the next player.",
    "oldGameConcede": "This game has run for over a month. Conceding to free the slot, feel free to start a new game any time.",
    "drawDecline": "Thanks, but I decline draws; accepting one would skew my win/loss stats. To end the game you can resign, or choose \"Propose to abandon the game collectively\" from the BGA menu and I'll accept that right away.",
    "difficultySet": "Difficulty set to {level} ({elo} Elo). Good luck!",
    "difficultyGrandmaster": "Difficulty set to grandmaster (full Stockfish). Good luck!"
  },
  "fr": {
    "greeting": "Salut ! Je suis bot_stockfish, un bot d'échecs sur Board Game Arena https://stockfish.ross.gg/ \nPar défaut, je suis Stockfish (~2800), un bot d'échecs de niveau grand maître basé sur le travail réalisé par https://stockfishchess.org/ \n\nVous voulez changer la difficulté ? À tout moment, tapez l'un de ces cinq mots pour régler mon niveau :\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBonne chance !",
    "chatReply": "Je ne suis pas sûr.",
    "closing": "Bien joué !",
    "randomFallback": "Le moteur ne répond pas, je joue un coup légal au hasard.",
    "concede": "Je rencontre trop d'erreurs techniques dans cette partie et dois abandonner. Désolé !",
    "opponentTimeout": "Vous êtes à votre tour depuis plus de 15 minutes. Je ne peux jouer qu'une partie en temps réel à la fois, donc j'abandonne pour libérer la place. Jouez-moi en asynchrone si vous voulez prendre votre temps.",
    "oppQuit": "Mon adversaire semble être parti. J'abandonne pour libérer la place en temps réel pour le prochain joueur.",
    "oldGameConcede": "Cette partie dure depuis plus d'un mois. J'abandonne pour libérer la place, n'hésitez pas à relancer une partie à tout moment.",
    "drawDecline": "Merci, mais je refuse les nulles ; en accepter une fausserait mes statistiques de victoires/défaites. Pour terminer la partie, vous pouvez abandonner, ou choisir « Proposer d'abandonner la partie collectivement » dans le menu BGA et j'accepterai aussitôt.",
    "difficultySet": "Difficulté réglée sur {level} ({elo} Elo). Bonne chance !",
    "difficultyGrandmaster": "Difficulté réglée sur grand maître (Stockfish complet). Bonne chance !"
  },
  "es": {
    "greeting": "¡Hola! Soy bot_stockfish, un bot de ajedrez en Board Game Arena https://stockfish.ross.gg/ \nPor defecto soy Stockfish (~2800), un bot de ajedrez con nivel de gran maestro basado en el trabajo realizado por https://stockfishchess.org/ \n\n¿Quieres cambiar la dificultad? En cualquier momento, escribe una de estas cinco palabras para fijar mi nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n¡Buena suerte!",
    "chatReply": "No estoy seguro.",
    "closing": "¡Buena partida!",
    "randomFallback": "Error del motor de juego, realizo un movimiento legal al azar.",
    "concede": "Se están produciendo demasiados errores de sistema en esta partida y debo abandonar. ¡Lo siento!",
    "opponentTimeout": "Llevas más de 15 minutos en tu turno. Solo puedo jugar una partida en tiempo real a la vez, así que abandono para liberar el sitio. Si quieres tomarte tu tiempo, juega conmigo en modo asíncrono.",
    "oppQuit": "Parece que mi rival se ha ido. Abandono para liberar el lugar en tiempo real para el siguiente jugador.",
    "oldGameConcede": "Esta partida lleva más de un mes. Abandono para liberar el lugar; puedes empezar una nueva cuando quieras.",
    "drawDecline": "Gracias, pero rechazo las tablas; aceptar una distorsionaría mis estadísticas de victorias/derrotas. Para terminar la partida puedes rendirte, o elegir «Proponer abandonar la partida colectivamente» en el menú de BGA y lo aceptaré enseguida.",
    "difficultySet": "Dificultad ajustada a {level} ({elo} Elo). ¡Buena suerte!",
    "difficultyGrandmaster": "Dificultad ajustada a gran maestro (Stockfish completo). ¡Buena suerte!"
  },
  "pt": {
    "greeting": "Olá! Eu sou o bot_stockfish, um bot de xadrez no Board Game Arena https://stockfish.ross.gg/ \nMeu padrão é o Stockfish (~2800), um bot de xadrez com força de grande mestre baseado no trabalho feito por https://stockfishchess.org/ \n\nQuer mudar a dificuldade? A qualquer momento, digite uma destas cinco palavras para definir o meu nível:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBoa sorte!",
    "chatReply": "Não tenho certeza.",
    "closing": "Bom jogo!",
    "randomFallback": "Falha no motor de xadrez, jogando um lance legal aleatório.",
    "concede": "Ocorreram erros técnicos demais nesta partida e preciso desistir. Desculpe!",
    "opponentTimeout": "Você está na sua vez há mais de 15 minutos. Só consigo jogar uma partida em tempo real por vez, então estou desistindo para liberar a vaga. Jogue comigo no modo assíncrono se quiser mais tempo.",
    "oppQuit": "Meu oponente parece ter saído. Desistindo para liberar a vaga em tempo real para o próximo jogador.",
    "oldGameConcede": "Esta partida já dura mais de um mês. Desistindo para liberar a vaga; sinta-se à vontade para começar uma nova quando quiser.",
    "drawDecline": "Obrigado, mas recuso empates; aceitar um distorceria minhas estatísticas de vitórias/derrotas. Para terminar a partida você pode desistir, ou escolher \"Propor abandonar a partida coletivamente\" no menu do BGA e eu aceito na hora.",
    "difficultySet": "Dificuldade definida como {level} ({elo} Elo). Boa sorte!",
    "difficultyGrandmaster": "Dificuldade definida como grande mestre (Stockfish completo). Boa sorte!"
  },
  "it": {
    "greeting": "Ciao! Sono bot_stockfish, un bot di scacchi su Board Game Arena https://stockfish.ross.gg/ \nPer impostazione predefinita sono Stockfish (~2800), un bot di scacchi di livello gran maestro basato sul lavoro svolto da https://stockfishchess.org/ \n\nVuoi cambiare la difficoltà? In qualsiasi momento, scrivi una di queste cinque parole per impostare il mio livello:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBuona fortuna!",
    "chatReply": "Non ne sono sicuro.",
    "closing": "Bella partita!",
    "randomFallback": "Il motore di gioco non risponde, eseguo una mossa legale casuale.",
    "concede": "Si stanno verificando troppi errori di sistema e devo abbandonare la partita. Scusa!",
    "opponentTimeout": "Sei al tuo turno da più di 15 minuti. Posso giocare una sola partita in tempo reale alla volta, quindi abbandono per liberare il posto. Giocami in modalità asincrona se vuoi prenderti il tuo tempo.",
    "oppQuit": "Il mio avversario sembra essersene andato. Abbandono per liberare il posto in tempo reale per il prossimo giocatore.",
    "oldGameConcede": "Questa partita dura da più di un mese. Abbandono per liberare il posto; sentiti libero di iniziarne una nuova quando vuoi.",
    "drawDecline": "Grazie, ma rifiuto le patte; accettarne una falserebbe le mie statistiche di vittorie/sconfitte. Per terminare la partita puoi abbandonare, oppure scegliere «Proponi di abbandonare la partita collettivamente» dal menu di BGA e accetterò subito.",
    "difficultySet": "Difficoltà impostata su {level} ({elo} Elo). Buona fortuna!",
    "difficultyGrandmaster": "Difficoltà impostata su gran maestro (Stockfish completo). Buona fortuna!"
  },
  "de": {
    "greeting": "Hi! Ich bin bot_stockfish, ein Schach-Bot auf Board Game Arena https://stockfish.ross.gg/ \nStandardmäßig bin ich Stockfish (~2800), ein Schach-Bot mit Großmeisterstärke, basierend auf der Arbeit von https://stockfishchess.org/ \n\nMöchtest du die Schwierigkeit ändern? Tippe jederzeit eines dieser fünf Wörter, um mein Niveau einzustellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nViel Glück!",
    "chatReply": "Ich bin mir nicht sicher.",
    "closing": "Gutes Spiel!",
    "randomFallback": "Engine-Abfrage fehlgeschlagen, ich spiele einen zufälligen legalen Zug.",
    "concede": "Es treten zu many Systemfehler auf, daher muss ich diese Partie leider aufgeben. Tut mir leid!",
    "opponentTimeout": "Du bist seit über 15 Minuten am Zug. Ich kann nur eine Echtzeitpartie gleichzeitig spielen, daher gebe ich auf, um den Platz freizugeben. Spiel asynchron gegen mich, wenn du dir mehr Zeit lassen möchtest.",
    "oppQuit": "Mein Gegner scheint gegangen zu sein. Ich gebe auf, um den Echtzeitplatz für den nächsten Spieler freizugeben.",
    "oldGameConcede": "Diese Partie läuft seit über einem Monat. Ich gebe auf, um den Platz freizugeben; starte jederzeit gerne eine neue Partie.",
    "drawDecline": "Danke, aber ich lehne Remis ab; eines anzunehmen würde meine Sieg/Niederlage-Statistik verfälschen. Um die Partie zu beenden, kannst du aufgeben oder im BGA-Menü »Gemeinsame Spielaufgabe vorschlagen« wählen, und ich nehme sofort an.",
    "difficultySet": "Schwierigkeit auf {level} ({elo} Elo) gesetzt. Viel Glück!",
    "difficultyGrandmaster": "Schwierigkeit auf Großmeister (volles Stockfish) gesetzt. Viel Glück!"
  },
  "nl": {
    "greeting": "Hoi! Ik ben bot_stockfish, een schaakbot op Board Game Arena https://stockfish.ross.gg/ \nMijn standaard is Stockfish (~2800), een schaakbot op grootmeesterniveau gebaseerd op het werk van https://stockfishchess.org/ \n\nWil je de moeilijkheidsgraad wijzigen? Typ op elk moment een van deze vijf woorden om mijn niveau in te stellen:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeel succes!",
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
    "greeting": "Привет! Я bot_stockfish, шахматный бот на Board Game Arena https://stockfish.ross.gg/ \nПо умолчанию я Stockfish (~2800), шахматный бот уровня гроссмейстера, основанный на работе https://stockfishchess.org/ \n\nХотите изменить сложность? В любой момент введите одно из этих пяти слов, чтобы задать мой уровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nУдачи!",
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
    "greeting": "Привіт! Я bot_stockfish, шаховий бот на Board Game Arena https://stockfish.ross.gg/ \nЗа замовчуванням я Stockfish (~2800), шаховий бот рівня гросмейстера, заснований на роботі https://stockfishchess.org/ \n\nХочете змінити складність? У будь-який момент введіть одне з цих п'яти слів, щоб задати мій рівень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nЩасти!",
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
    "greeting": "Cześć! Jestem bot_stockfish, bot szachowy na Board Game Arena https://stockfish.ross.gg/ \nDomyślnie jestem Stockfish (~2800), botem szachowym o sile arcymistrza, opartym na pracy wykonanej przez https://stockfishchess.org/ \n\nChcesz zmienić poziom trudności? W dowolnym momencie wpisz jedno z tych pięciu słów, aby ustawić mój poziom:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nPowodzenia!",
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
    "greeting": "Ahoj! Jsem bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nVe výchozím nastavení jsem Stockfish (~2800), šachový bot na úrovni velmistra založený na práci od https://stockfishchess.org/ \n\nChceš změnit obtížnost? Kdykoli napiš jedno z těchto pěti slov, abys nastavil mou úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nHodně štěstí!",
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
    "greeting": "Ahoj! Som bot_stockfish, šachový bot na Board Game Arena https://stockfish.ross.gg/ \nV predvolenom nastavení som Stockfish (~2800), šachový bot na úrovni veľmajstra založený na práci od https://stockfishchess.org/ \n\nChceš zmeniť obtiažnosť? Kedykoľvek napíš jedno z týchto piatich slov, aby si nastavil moju úroveň:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeľa šťastia!",
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
    "greeting": "Salut! Sunt bot_stockfish, un bot de șah pe Board Game Arena https://stockfish.ross.gg/ \nÎn mod implicit sunt Stockfish (~2800), un bot de șah de nivel mare maestru bazat pe munca depusă de https://stockfishchess.org/ \n\nVrei să schimbi dificultatea? În orice moment, scrie unul dintre aceste cinci cuvinte ca să-mi setezi nivelul:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nMult noroc!",
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
    "greeting": "Hej! Jag är bot_stockfish, en schackbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard är jag Stockfish (~2800), en schackbot på stormästarnivå baserad på arbete gjort av https://stockfishchess.org/ \n\nVill du ändra svårighetsgraden? Skriv när som helst ett av dessa fem ord för att ställa in min nivå:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nLycka till!",
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
    "greeting": "Hej! Jeg er bot_stockfish, en skakbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard er jeg Stockfish (~2800), en skakbot på stormesterniveau baseret på arbejde udført af https://stockfishchess.org/ \n\nVil du ændre sværhedsgraden? Skriv når som helst et af disse fem ord for at indstille mit niveau:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nHeld og lykke!",
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
    "greeting": "Hei! Jeg er bot_stockfish, en sjakkbot på Board Game Arena https://stockfish.ross.gg/ \nSom standard er jeg Stockfish (~2800), en sjakkbot på stormesternivå baseret på arbeid utført av https://stockfishchess.org/ \n\nVil du endre vanskelighetsgraden? Skriv når som helst ett av disse fem ordene for å stille inn nivået mitt:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nLykke til!",
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
    "greeting": "Hei! Olen bot_stockfish, shakkibotti Board Game Arenassa https://stockfish.ross.gg/ \nOletuksena olen Stockfish (~2800), suurmestaritason shakkibotti, joka perustuu sivuston https://stockfishchess.org/ tekemään työhön.\n\nHaluatko muuttaa vaikeustasoa? Kirjoita milloin tahansa yksi näistä viidestä sanasta asettaaksesi tasoni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nOnnea!",
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
    "greeting": "Szia! bot_stockfish vagyok, egy sakkbot a Board Game Arena-n https://stockfish.ross.gg/ \nAlapértelmezetten Stockfish vagyok (~2800), egy nagymesteri szintű sakkbot, amely a https://stockfishchess.org/ munkáján alapul.\n\nSzeretnéd megváltoztatni a nehézséget? Bármikor írd be az alábbi öt szó egyikét a szintem beállításához:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSok sikert!",
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
    "greeting": "Γεια! Είμαι ο bot_stockfish, ένα bot σκακιού στο Board Game Arena https://stockfish.ross.gg/ \nΑπό προεπιλογή είμαι ο Stockfish (~2800), ένα bot σκακιού επιπέδου γκραν μάστερ που βασίζεται στην εργασία που έγινε από το https://stockfishchess.org/ \n\nΘέλεις να αλλάξεις τη δυσκολία; Οποιαδήποτε στιγμή, γράψε μία από αυτές τις πέντε λέξεις για να ορίσεις το επίπεδό μου:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nΚαλή τύχη!",
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
    "greeting": "Merhaba! Ben Board Game Arena'da bir satranç botu olan bot_stockfish https://stockfish.ross.gg/ \nVarsayılan olarak, https://stockfishchess.org/ tarafından yapılan çalışmalara dayanan büyük usta seviyesinde bir satranç botu olan Stockfish'im (~2800).\n\nZorluğu değiştirmek ister misin? İstediğin zaman, seviyemi ayarlamak için şu beş kelimeden birini yaz:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBol şans!",
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
    "greeting": "مرحبًا! أنا bot_stockfish، بوت شطرنج على Board Game Arena https://stockfish.ross.gg/ \nافتراضيًا، أنا Stockfish (~2800)، بوت شطرنج بمستوى أستاذ كبير يعتمد على العمل الذي قام به موقع https://stockfishchess.org/ \n\nهل تريد تغيير الصعوبة؟ في أي وقت، اكتب إحدى هذه الكلمات الخمس لضبط مستواي:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nحظًا موفقًا!",
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
    "greeting": "היי! אני bot_stockfish, בוט שחמט ב-Board Game Arena https://stockfish.ross.gg/ \nכברירת מחדל אני Stockfish (~2800), בוט שחמט ברמת רב-אמן המבוסס על העבודה שנעשתה על ידי https://stockfishchess.org/ \n\nרוצה לשנות את רמת הקושי? בכל שלב, הקלד אחת מחמש המילים האלה כדי לקבוע את הרמה שלי:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nבהצלחה!",
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
    "greeting": "こんにちは！私はBoard Game Arenaのチェスボット、bot_stockfishです：https://stockfish.ross.gg/ \nデフォルトでは、https://stockfishchess.org/ の成果に基づいたグランドマスター級のチェスボット、Stockfish（~2800）になります。\n\n難易度を変更しますか？いつでも、次の5つの単語のいずれかを入力して私のレベルを設定してください：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n頑張ってください！",
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
    "greeting": "嗨！我是 bot_stockfish，Board Game Arena 上的一个国际象棋机器人 https://stockfish.ross.gg/ \n我默认是 Stockfish (~2800)，一个基于 https://stockfishchess.org/ 所做工作的特级大师水平国际象棋机器人。\n\n想要更改难度吗？在任何时候，输入下列五个词的其中一个来设置我的难度：\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n祝你好运！",
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
    "greeting": "안녕하세요! 저는 Board Game Arena의 체스 봇인 bot_stockfish입니다 https://stockfish.ross.gg/ \n기본적으로 저는 https://stockfishchess.org/의 작업을 기반으로 한 그랜드마스터 수준의 체스 봇인 Stockfish (~2800)입니다.\n\n난이도를 변경하시겠습니까? 언제든지 다음 다섯 단어 중 하나를 입력해 제 레벨을 설정하세요:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\n행운을 빌어요!",
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
    "greeting": "Xin chào! Tôi là bot_stockfish, một bot cờ vua trên Board Game Arena https://stockfish.ross.gg/ \nMặc định tôi là Stockfish (~2800), một bot cờ vua trình đại kiện tướng dựa trên nền tảng của https://stockfishchess.org/ \n\nMuốn thay đổi độ khó? Bất cứ lúc nào, hãy gõ một trong các từ sau để đặt cấp độ của tôi:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nChúc may mắn!",
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
    "greeting": "Hai! Saya bot_stockfish, sebuah bot catur di Board Game Arena https://stockfish.ross.gg/ \nSecara default saya Stockfish (~2800), sebuah bot catur level grandmaster yang berbasis dari karya https://stockfishchess.org/ \n\nMau mengubah tingkat kesulitan? Kapan saja, ketik salah satu dari lima kata ini untuk mengatur levelku:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSemoga berhasil!",
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
    "greeting": "Hai! Saya bot_stockfish, bot catur di Board Game Arena https://stockfish.ross.gg/ \nSecara lalai saya Stockfish (~2800), bot catur taraf grandmaster berdasarkan kerja yang dilakukan oleh https://stockfishchess.org/ \n\nMahu mengubah kesukaran? Pada bila-bila masa, taip salah satu daripada lima perkataan ini untuk menetapkan tahap saya:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSemoga berjaya!",
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
    "greeting": "Hola! Soc bot_stockfish, un bot d'escacs a Board Game Arena https://stockfish.ross.gg/ \nPer defecte soc Stockfish (~2800), un bot d'escacs de nivell gran mestre basat en el treball realitzat per https://stockfishchess.org/ \n\nVols canviar la dificultat? En qualsevol moment, escriu una d'aquestes cinc paraules per fixar el meu nivell:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBona sort!",
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
    "greeting": "Ola! Son bot_stockfish, un bot de xadrez en Board Game Arena https://stockfish.ross.gg/ \nPor defecto son Stockfish (~2800), un bot de xadrez de nivel gran mestre baseado no traballo feito por https://stockfishchess.org/ \n\nQueres cambiar a dificultade? En calquera momento, escribe unha destas cinco palabras para fixar o meu nivel:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nBoa sorte!",
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
    "greeting": "Bok! Ja sam bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nPrema zadanim postavkama ja sam Stockfish (~2800), šahovski bot razine velemajstora koji se temelji na radu s https://stockfishchess.org/ \n\nŽeliš li promijeniti težinu? U bilo kojem trenutku upiši jednu od ovih pet riječi da postaviš moju razinu:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSretno!",
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
    "greeting": "Здраво! Ја сам bot_stockfish, шаховски бот на Board Game Arena https://stockfish.ross.gg/ \nПодразумевано сам Stockfish (~2800), шаховски бот нивоа велемајстора заснован на раду са https://stockfishchess.org/ \n\nЖелиш ли да промениш тежину? У било ком тренутку упиши једну од ових пет речи да подесиш мој ниво:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nСрећно!",
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
    "greeting": "Živjo! Sem bot_stockfish, šahovski bot na Board Game Arena https://stockfish.ross.gg/ \nPrivzeto sem Stockfish (~2800), šahovski bot ravni velemojstra, ki temelji na delu s https://stockfishchess.org/ \n\nBi želel spremeniti težavnost? Kadar koli vpiši eno od teh petih besed, da nastaviš mojo raven:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSrečno!",
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
    "greeting": "Здравей! Аз съм bot_stockfish, шахматен бот в Board Game Arena https://stockfish.ross.gg/ \nПо подразбиране съм Stockfish (~2800), шахматен бот на ниво гросмайстор, базиран на работата на https://stockfishchess.org/ \n\nИскаш ли да промениш трудността? По всяко време напиши една от тези пет думи, за да зададеш нивото ми:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nУспех!",
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
    "greeting": "Labas! Esu bot_stockfish, šachmatų robotas platformoje Board Game Arena https://stockfish.ross.gg/ \nPagal numatytuosius nustatymus esu Stockfish (~2800) – didmeistrio lygio šachmatų robotas, sukurtas remiantis https://stockfishchess.org/ atliktu darbu.\n\nNori pakeisti sudėtingumą? Bet kuriuo metu įrašyk vieną iš šių penkių žodžių, kad nustatytum mano lygį:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nSėkmės!",
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
    "greeting": "Sveiki! Esmu bot_stockfish, šaha bots platformā Board Game Arena https://stockfish.ross.gg/ \nPēc noklusējuma esmu Stockfish (~2800), lielmeistara līmeņa šaha bots, kura pamatā ir https://stockfishchess.org/ veiktais darbs.\n\nVai vēlies mainīt grūtības pakāpi? Jebkurā laikā ieraksti vienu no šiem pieciem vārdiem, lai iestatītu manu līmeni:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nVeiksmi!",
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
    "greeting": "Hei! Olen bot_stockfish, malebot keskkonnas Board Game Arena https://stockfish.ross.gg/ \nVaikimisi olen Stockfish (~2800), suurmeistri tasemel malebot, mis põhineb veebilehe https://stockfishchess.org/ arendustööl.\n\nKas soovid muuta raskusastet? Mis tahes ajal kirjuta üks neist viiest sõnast, et määrata mu tase:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nEdu!",
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
    "greeting": "درود! من bot_stockfish هستم، یک ربات شطرنج در Board Game Arena https://stockfish.ross.gg/ \nمن به‌طور پیش‌فرض Stockfish (~2800) هستم، یک ربات شطرنج در سطح استاد بزرگ بر پایه کارهای انجام‌شده توسط https://stockfishchess.org/ \n\nمی‌خواهی سختی را تغییر دهی؟ در هر زمان، یکی از این پنج کلمه را تایپ کن تا سطحم را تنظیم کنی:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nموفق باشی!",
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
    "greeting": "Прывіт! Я bot_stockfish, шахматны бот на Board Game Arena https://stockfish.ross.gg/ \nПа змаўчанні я Stockfish (~2800), шахматны бот узроўню гросмайстра, заснаваны на працы https://stockfishchess.org/ \n\nХочаш змяніць складанасць? У любы час напішы адно з гэтых пяці слоў, каб задаць мой узровень:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nПоспехаў!",
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
    "greeting": "Demat! bot_stockfish ez on, ur bot echedoù war Board Game Arena https://stockfish.ross.gg/ \nDre ziouer ez on Stockfish (~2800), ur bot echedoù a-live mestr-meur diazezet war al labour graet gant https://stockfishchess.org/ \n\nC'hoant ho peus da gemmañ an diaesterezh? Pa gerot, skrivit unan eus ar pemp ger-mañ evit termeniñ ma live:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nChañs vat!",
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
    "greeting": "สวัสดีครับ! ผมคือ bot_stockfish บอทหมากรุกบน Board Game Arena https://stockfish.ross.gg/ \nโดยค่าเริ่มต้นผมคือ Stockfish (~2800) บอทหมากรุกระดับแกรนด์มาสเตอร์ที่พัฒนาต่อยอดมาจากงานของ https://stockfishchess.org/ \n\nอยากเปลี่ยนความยากไหม? เมื่อใดก็ได้ พิมพ์หนึ่งในห้าคำนี้เพื่อตั้งระดับของผม:\n\nbeginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nขอให้โชคดี!",
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
