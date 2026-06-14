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
  | "difficultyGrandmaster"
  | "premiumGate"
  | "premiumGateAsyncOther";

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
    "greeting": "Hi! I'm bot_stockfish, a grandmaster-strength chess bot (Stockfish, ~2800). Type beginner, easy, intermediate, advanced or expert anytime to lower my level. Info + live stats: https://stockfish.ross.gg/",
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
    "greeting": "Salut ! Je suis bot_stockfish, un bot d'échecs de niveau grand maître (Stockfish, ~2800). Tapez beginner, easy, intermediate, advanced ou expert pour changer de niveau. Info : https://stockfish.ross.gg/",
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
    "greeting": "¡Hola! Soy bot_stockfish, un bot de ajedrez nivel gran maestro (Stockfish, ~2800). Escribe beginner, easy, intermediate, advanced o expert para bajar mi nivel. Info: https://stockfish.ross.gg/",
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
    "greeting": "Olá! Eu sou o bot_stockfish, um bot de xadrez nível grande mestre (Stockfish, ~2800). Digite beginner, easy, intermediate, advanced ou expert para mudar o nível. Info: https://stockfish.ross.gg/",
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
    "greeting": "Ciao! Sono bot_stockfish, un bot di scacchi di livello gran maestro (Stockfish, ~2800). Scrivi beginner, easy, intermediate, advanced o expert per cambiare livello. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hi! Ich bin bot_stockfish, ein Schach-Bot mit Großmeisterstärke (Stockfish, ~2800). Tippe beginner, easy, intermediate, advanced oder expert, um mein Niveau zu ändern. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hoi! Ik ben bot_stockfish, een schaakbot op grootmeesterniveau (Stockfish, ~2800). Typ beginner, easy, intermediate, advanced of expert om het niveau te wijzigen. Info: https://stockfish.ross.gg/",
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
    "greeting": "Привет! Я bot_stockfish, шахматный бот уровня гроссмейстера (Stockfish, ~2800). Введи beginner, easy, intermediate, advanced или expert для смены уровня. Инфо: https://stockfish.ross.gg/",
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
    "greeting": "Привіт! Я bot_stockfish, шаховий бот рівня гросмейстера (Stockfish, ~2800). Введіть beginner, easy, intermediate, advanced або expert для зміни рівня. Інфо: https://stockfish.ross.gg/",
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
    "greeting": "Cześć! Jestem bot_stockfish, bot szachowy o sile arcymistrza (Stockfish, ~2800). Wpisz beginner, easy, intermediate, advanced lub expert, aby zmienić poziom. Info: https://stockfish.ross.gg/",
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
    "greeting": "Ahoj! Jsem bot_stockfish, šachový bot na úrovni velmistra (Stockfish, ~2800). Napiš beginner, easy, intermediate, advanced nebo expert pro změnu úrovně. Info: https://stockfish.ross.gg/",
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
    "greeting": "Ahoj! Som bot_stockfish, šachový bot na úrovni veľmajstra (Stockfish, ~2800). Napíš beginner, easy, intermediate, advanced alebo expert pre zmenu úrovne. Info: https://stockfish.ross.gg/",
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
    "greeting": "Salut! Sunt bot_stockfish, un bot de șah de nivel mare maestru (Stockfish, ~2800). Scrie beginner, easy, intermediate, advanced sau expert pentru a schimba nivelul. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hej! Jag är bot_stockfish, en schackbot på stormästarnivå (Stockfish, ~2800). Skriv beginner, easy, intermediate, advanced eller expert för att ändra nivå. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hej! Jeg er bot_stockfish, en skakbot på stormesterniveau (Stockfish, ~2800). Skriv beginner, easy, intermediate, advanced eller expert for at ændre niveauet. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hei! Jeg er bot_stockfish, en sjakkbot på stormesternivå (Stockfish, ~2800). Skriv beginner, easy, intermediate, advanced eller expert for å endre nivået. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hei! Olen bot_stockfish, suurmestaritason shakkibotti (Stockfish, ~2800). Kirjoita beginner, easy, intermediate, advanced tai expert muuttaaksesi tasoa. Info: https://stockfish.ross.gg/",
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
    "greeting": "Szia! bot_stockfish vagyok, egy nagymesteri szintű sakkbot (Stockfish, ~2800). Írd be a beginner, easy, intermediate, advanced vagy expert szót a szintmódosításhoz. Info: https://stockfish.ross.gg/",
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
    "greeting": "Γεια! Είμαι ο bot_stockfish, bot σκακιού επιπέδου γκραν μάστερ (Stockfish, ~2800). Γράψε beginner, easy, intermediate, advanced ή expert για αλλαγή επιπέδου. Info: https://stockfish.ross.gg/",
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
    "greeting": "Merhaba! Ben büyük usta seviyesinde bir satranç botu olan bot_stockfish (Stockfish, ~2800). Seviye değiştirmek için beginner, easy, intermediate, advanced veya expert yazın. Bilgi: https://stockfish.ross.gg/",
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
    "greeting": "مرحبًا! أنا bot_stockfish، بوت شطرنج بمستوى أستاذ كبير (Stockfish، ~2800). اكتب beginner، أو easy، أو intermediate، أو advanced، أو expert لتغيير المستوى. الرابط: https://stockfish.ross.gg/",
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
    "greeting": "היי! אני bot_stockfish, בוט שחמט ברמת רב-אמן (Stockfish, ~2800). הקלד beginner, easy, intermediate, advanced או expert לשינוי הרמה. מידע: https://stockfish.ross.gg/",
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
    "greeting": "こんにちは！グランドマスター級チェスボットのbot_stockfishです（Stockfish、~2800）。beginner、easy、intermediate、advanced、expertを入力してレベル変更。詳細：https://stockfish.ross.gg/",
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
    "greeting": "嗨！我是特级大师水平的国际象棋机器人 bot_stockfish (Stockfish, ~2800)。输入 beginner、easy、intermediate、advanced 或 expert 可更改难度。详情：https://stockfish.ross.gg/",
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
    "greeting": "안녕하세요! 그랜드마스터 수준의 체스 봇 bot_stockfish입니다 (Stockfish, ~2800). 레벨을 낮추려면 언제든지 beginner, easy, intermediate, advanced, expert를 입력하세요. 안내: https://stockfish.ross.gg/",
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
    "greeting": "Xin chào! Tôi là bot_stockfish, bot cờ vua trình đại kiện tướng (Stockfish, ~2800). Gõ beginner, easy, intermediate, advanced hoặc expert để đổi cấp độ. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hai! Saya bot_stockfish, bot catur level grandmaster (Stockfish, ~2800). Ketik beginner, easy, intermediate, advanced, atau expert untuk mengubah level. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hai! Saya bot_stockfish, bot catur tahap grandmaster (Stockfish, ~2800). Taip beginner, easy, intermediate, advanced atau expert untuk menukar tahap. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hola! Soc bot_stockfish, un bot d'escacs de nivell gran mestre (Stockfish, ~2800). Escriu beginner, easy, intermediate, advanced o expert per abaixar el nivell. Info: https://stockfish.ross.gg/",
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
    "greeting": "Ola! Son bot_stockfish, un bot de xadrez nivel gran mestre (Stockfish, ~2800). Escribe beginner, easy, intermediate, advanced ou expert para baixar o nivel. Info: https://stockfish.ross.gg/",
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
    "greeting": "Bok! Ja sam bot_stockfish, šahovski bot razine velemajstora (Stockfish, ~2800). Upiši beginner, easy, intermediate, advanced ili expert za promjenu razine. Info: https://stockfish.ross.gg/",
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
    "greeting": "Здраво! Ја сам bot_stockfish, шаховски бот нивоа велемајстора (Stockfish, ~2800). Упиши beginner, easy, intermediate, advanced или expert за промену нивоа. Инфо: https://stockfish.ross.gg/",
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
    "greeting": "Živjo! Sem bot_stockfish, šahovski bot ravni velemojstra (Stockfish, ~2800). Vpiši beginner, easy, intermediate, advanced ali expert za spremembo ravni. Info: https://stockfish.ross.gg/",
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
    "greeting": "Здравей! Аз съм bot_stockfish, шах бот с ниво на гросмайстор (Stockfish, ~2800). Напиши beginner, easy, intermediate, advanced или expert за смяна на нивото. Инфо: https://stockfish.ross.gg/",
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
    "greeting": "Labas! Esu bot_stockfish, didmeistrio lygio šachmatų robotas (Stockfish, ~2800). Įrašyk beginner, easy, intermediate, advanced arba expert lygio pakeitimui. Info: https://stockfish.ross.gg/",
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
    "greeting": "Sveiki! Esmu bot_stockfish, lielmeistara līmeņa šaha bots (Stockfish, ~2800). Ieraksti beginner, easy, intermediate, advanced vai expert, lai mainītu līmeni. Info: https://stockfish.ross.gg/",
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
    "greeting": "Hei! Olen bot_stockfish, suurmeistri tasemel malebot (Stockfish, ~2800). Kirjuta beginner, easy, intermediate, advanced või expert, et muuta taset. Info: https://stockfish.ross.gg/",
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
    "greeting": "درود! من bot_stockfish هستم، ربات شطرنج در سطح استاد بزرگ (Stockfish، ~2800). کلمات beginner، easy، intermediate، advanced یا expert را برای تغییر سطح تایپ کنید. لینک: https://stockfish.ross.gg/",
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
    "greeting": "Прывіт! Я bot_stockfish, шахматны бот узроўню гросмайстра (Stockfish, ~2800). Напішы beginner, easy, intermediate, advanced ці expert, каб знізіць узровень. Інфа: https://stockfish.ross.gg/",
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
    "greeting": "Demat! bot_stockfish a-live mestr-meur (Stockfish, ~2800) ez on. Skriv beginner, easy, intermediate, advanced pe expert evit kemmañ al live. Titouroù: https://stockfish.ross.gg/",
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
    "greeting": "สวัสดีครับ! ผมคือ bot_stockfish บอทหมากรุกระดับแกรนด์มาสเตอร์ (Stockfish, ~2800) พิมพ์ beginner, easy, intermediate, advanced หรือ expert เพื่อเปลี่ยนระดับ ลิงก์: https://stockfish.ross.gg/",
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
 * The premium-gate nudge, in all 41 BGA interface languages. Kept as one
 * consolidated map (rather than a line in each language block above) so the
 * full set is easy to review/translate in one place; it's merged into
 * TRANSLATIONS below so `t("premiumGate", lang, { link })` resolves exactly
 * like every other key. "{link}" is the per-user upgrade URL (it routes
 * through the worker so the click is logged, then redirects to BGA Premium).
 * "BGA Premium" and "Stockfish" stay untranslated; no em-dashes anywhere.
 */
const PREMIUM_GATE: Record<string, string> = {
  "en": "Sorry! Realtime games and several games at once are reserved for BGA Premium members, because my playing time is a limited resource. Free members can always play one asynchronous (turn-based) game with me at a time, which is unlimited over time. To unlock realtime and simultaneous games, upgrade to BGA Premium here: {link} Thanks for understanding, and good luck!",
  "fr": "Désolé ! Les parties en temps réel et plusieurs parties à la fois sont réservées aux membres BGA Premium, car mon temps de jeu est une ressource limitée. Les membres gratuits peuvent toujours jouer une partie asynchrone (au tour par tour) à la fois avec moi, ce qui est illimité dans le temps. Pour débloquer le temps réel et les parties simultanées, passez à BGA Premium ici : {link} Merci de votre compréhension, et bonne chance !",
  "es": "¡Lo siento! Las partidas en tiempo real y varias partidas a la vez están reservadas a los miembros BGA Premium, porque mi tiempo de juego es un recurso limitado. Los miembros gratuitos siempre pueden jugar una partida asíncrona (por turnos) conmigo a la vez, lo cual es ilimitado con el tiempo. Para desbloquear el tiempo real y las partidas simultáneas, hazte BGA Premium aquí: {link} ¡Gracias por tu comprensión y buena suerte!",
  "pt": "Desculpe! Partidas em tempo real e várias partidas ao mesmo tempo são reservadas a membros BGA Premium, porque o meu tempo de jogo é um recurso limitado. Membros gratuitos podem sempre jogar uma partida assíncrona (por turnos) comigo de cada vez, o que é ilimitado ao longo do tempo. Para desbloquear o tempo real e partidas simultâneas, torne-se BGA Premium aqui: {link} Obrigado pela compreensão e boa sorte!",
  "it": "Spiacente! Le partite in tempo reale e più partite contemporaneamente sono riservate ai membri BGA Premium, perché il mio tempo di gioco è una risorsa limitata. I membri gratuiti possono sempre giocare una partita asincrona (a turni) con me alla volta, il che è illimitato nel tempo. Per sbloccare il tempo reale e le partite simultanee, passa a BGA Premium qui: {link} Grazie per la comprensione e buona fortuna!",
  "de": "Entschuldigung! Echtzeitpartien und mehrere Partien gleichzeitig sind BGA-Premium-Mitgliedern vorbehalten, denn meine Spielzeit ist eine begrenzte Ressource. Kostenlose Mitglieder können jederzeit eine asynchrone (zugbasierte) Partie mit mir spielen, was zeitlich unbegrenzt ist. Um Echtzeit und gleichzeitige Partien freizuschalten, werde hier BGA Premium: {link} Danke für dein Verständnis und viel Glück!",
  "nl": "Sorry! Realtimespellen en meerdere spellen tegelijk zijn voorbehouden aan BGA Premium-leden, omdat mijn speeltijd een beperkte hulpbron is. Gratis leden kunnen altijd één asynchroon (beurtgebaseerd) spel tegelijk met mij spelen, wat onbeperkt is in de tijd. Om realtime en gelijktijdige spellen te ontgrendelen, word hier BGA Premium: {link} Bedankt voor je begrip en veel succes!",
  "ru": "Извините! Игры в реальном времени и несколько игр одновременно доступны только участникам BGA Premium, потому что моё игровое время ограничено. Бесплатные участники всегда могут играть со мной в одну асинхронную (пошаговую) игру за раз, и это не ограничено по времени. Чтобы открыть реальное время и одновременные игры, оформите BGA Premium здесь: {link} Спасибо за понимание и удачи!",
  "uk": "Вибачте! Ігри в реальному часі та кілька ігор одночасно доступні лише учасникам BGA Premium, адже мій ігровий час обмежений. Безкоштовні учасники завжди можуть грати зі мною в одну асинхронну (покрокову) гру за раз, і це необмежено в часі. Щоб відкрити реальний час і одночасні ігри, оформіть BGA Premium тут: {link} Дякую за розуміння та удачі!",
  "pl": "Przepraszam! Gry w czasie rzeczywistym i kilka gier naraz są zarezerwowane dla członków BGA Premium, ponieważ mój czas gry to ograniczony zasób. Darmowi członkowie zawsze mogą grać ze mną w jedną grę asynchroniczną (turową) naraz, co jest nieograniczone w czasie. Aby odblokować czas rzeczywisty i jednoczesne gry, przejdź na BGA Premium tutaj: {link} Dziękuję za zrozumienie i powodzenia!",
  "cs": "Promiň! Hry v reálném čase a více her najednou jsou vyhrazeny členům BGA Premium, protože můj herní čas je omezený zdroj. Členové zdarma si se mnou mohou kdykoli zahrát jednu asynchronní (tahovou) hru naráz, což je časově neomezené. Pro odemčení reálného času a souběžných her přejdi na BGA Premium zde: {link} Děkuji za pochopení a hodně štěstí!",
  "sk": "Prepáč! Hry v reálnom čase a viac hier naraz sú vyhradené pre členov BGA Premium, pretože môj herný čas je obmedzený zdroj. Členovia zadarmo si so mnou môžu kedykoľvek zahrať jednu asynchrónnu (ťahovú) hru naraz, čo je časovo neobmedzené. Na odomknutie reálneho času a súbežných hier prejdi na BGA Premium tu: {link} Ďakujem za pochopenie a veľa šťastia!",
  "sl": "Oprosti! Igre v realnem času in več iger hkrati so na voljo le članom BGA Premium, ker je moj čas igranja omejen vir. Brezplačni člani lahko z mano vedno igrajo eno asinhrono (potezno) igro naenkrat, kar je časovno neomejeno. Za odklep realnega časa in hkratnih iger nadgradi na BGA Premium tukaj: {link} Hvala za razumevanje in veliko sreče!",
  "sr": "Извини! Игре у реалном времену и више игара одједном резервисане су за BGA Premium чланове, јер је моје време за игру ограничен ресурс. Бесплатни чланови увек могу да играју једну асинхрону (потезну) игру са мном у датом тренутку, што је временски неограничено. Да откључаш реално време и истовремене игре, пређи на BGA Premium овде: {link} Хвала на разумевању и срећно!",
  "hr": "Oprosti! Igre u stvarnom vremenu i više igara odjednom rezervirane su za BGA Premium članove jer je moje vrijeme za igru ograničen resurs. Besplatni članovi uvijek mogu sa mnom igrati jednu asinkronu (poteznu) igru odjednom, što je vremenski neograničeno. Da otključaš stvarno vrijeme i istovremene igre, prijeđi na BGA Premium ovdje: {link} Hvala na razumijevanju i sretno!",
  "bg": "Съжалявам! Игрите в реално време и няколко игри едновременно са запазени за членовете на BGA Premium, защото времето ми за игра е ограничен ресурс. Безплатните членове винаги могат да играят с мен по една асинхронна (ход по ход) игра наведнъж, което е неограничено във времето. За да отключиш реалното време и едновременните игри, премини към BGA Premium тук: {link} Благодаря за разбирането и успех!",
  "ro": "Îmi pare rău! Jocurile în timp real și mai multe jocuri simultan sunt rezervate membrilor BGA Premium, deoarece timpul meu de joc este o resursă limitată. Membrii gratuiti pot juca oricând cu mine un singur joc asincron (pe ture) pe rând, ceea ce este nelimitat în timp. Pentru a debloca timpul real și jocurile simultane, treci la BGA Premium aici: {link} Mulțumesc pentru înțelegere și mult noroc!",
  "hu": "Bocsánat! A valós idejű játékok és az egyszerre több játék a BGA Premium tagoknak van fenntartva, mert a játékidőm korlátozott erőforrás. Az ingyenes tagok bármikor játszhatnak velem egyszerre egy aszinkron (körökre osztott) játékot, ami időben korlátlan. A valós idő és az egyidejű játékok feloldásához válts BGA Premiumra itt: {link} Köszönöm a megértést, és sok sikert!",
  "el": "Συγγνώμη! Τα παιχνίδια σε πραγματικό χρόνο και πολλά παιχνίδια ταυτόχρονα προορίζονται για τα μέλη BGA Premium, επειδή ο χρόνος παιχνιδιού μου είναι περιορισμένος πόρος. Τα δωρεάν μέλη μπορούν πάντα να παίζουν μαζί μου ένα ασύγχρονο (με σειρά) παιχνίδι τη φορά, το οποίο είναι απεριόριστο στον χρόνο. Για να ξεκλειδώσεις τον πραγματικό χρόνο και τα ταυτόχρονα παιχνίδια, κάνε αναβάθμιση σε BGA Premium εδώ: {link} Ευχαριστώ για την κατανόηση και καλή τύχη!",
  "tr": "Üzgünüm! Gerçek zamanlı oyunlar ve aynı anda birden fazla oyun BGA Premium üyelerine ayrılmıştır, çünkü oyun sürem sınırlı bir kaynaktır. Ücretsiz üyeler benimle her zaman aynı anda bir asenkron (sıra tabanlı) oyun oynayabilir, ki bu zaman içinde sınırsızdır. Gerçek zamanı ve eşzamanlı oyunları açmak için buradan BGA Premium'a geç: {link} Anlayışın için teşekkürler ve bol şans!",
  "ar": "آسف! المباريات الفورية ولعب عدة مباريات في وقت واحد مخصّصة لأعضاء BGA Premium، لأن وقت لعبي مورد محدود. يمكن للأعضاء المجانيين دائمًا أن يلعبوا معي مباراة واحدة غير متزامنة (بالأدوار) في كل مرة، وهذا غير محدود بمرور الوقت. لفتح اللعب الفوري والمباريات المتزامنة، انتقل إلى BGA Premium هنا: {link} شكرًا لتفهّمك وحظًا موفقًا!",
  "he": "מצטער! משחקים בזמן אמת וכמה משחקים בו זמנית שמורים לחברי BGA Premium, מפני שזמן המשחק שלי הוא משאב מוגבל. חברים חינמיים יכולים תמיד לשחק איתי משחק אסינכרוני (תורי) אחד בכל פעם, וזה ללא הגבלה לאורך זמן. כדי לפתוח משחק בזמן אמת ומשחקים בו זמנית, שדרג ל-BGA Premium כאן: {link} תודה על ההבנה ובהצלחה!",
  "fa": "ببخشید! بازی‌های هم‌زمان (real-time) و چند بازی به‌طور هم‌زمان مخصوص اعضای BGA Premium است، چون زمان بازی من منبعی محدود است. اعضای رایگان همیشه می‌توانند هر بار یک بازی ناهم‌زمان (نوبتی) با من انجام دهند که در طول زمان نامحدود است. برای باز کردن بازی هم‌زمان و چند بازی هم‌زمان، از اینجا به BGA Premium ارتقا دهید: {link} ممنون از درکتان و موفق باشید!",
  "ja": "ごめんなさい！リアルタイム対局や同時に複数の対局は、私のプレイ時間が限られた資源であるため、BGA Premium 会員専用です。無料会員の方も、いつでも私と非同期（ターン制）の対局を同時に1局だけプレイでき、これは時間的に無制限です。リアルタイムと同時対局を解放するには、こちらから BGA Premium にアップグレードしてください：{link} ご理解ありがとうございます、頑張ってください！",
  "ko": "죄송합니다! 실시간 게임과 동시에 여러 게임을 두는 것은 제 플레이 시간이 한정된 자원이기 때문에 BGA Premium 회원 전용입니다. 무료 회원도 언제든지 저와 한 번에 하나의 비동기(턴제) 게임을 둘 수 있으며, 이는 시간상 무제한입니다. 실시간 및 동시 게임을 잠금 해제하려면 여기에서 BGA Premium으로 업그레이드하세요: {link} 이해해 주셔서 감사하고 행운을 빕니다!",
  "zh": "抱歉！实时对局以及同时进行多盘对局仅向 BGA Premium 会员开放，因为我的对弈时间是有限的资源。免费会员随时可以与我进行一盘异步（回合制）对局，这在时间上是无限的。要解锁实时对局和同时多盘对局，请在此升级到 BGA Premium：{link} 感谢理解，祝你好运！",
  "th": "ขอโทษนะครับ! เกมเรียลไทม์และการเล่นหลายเกมพร้อมกันสงวนไว้สำหรับสมาชิก BGA Premium เพราะเวลาเล่นของผมเป็นทรัพยากรที่จำกัด สมาชิกฟรีสามารถเล่นเกมแบบอะซิงโครนัส (ผลัดกันเดิน) กับผมได้ครั้งละหนึ่งเกมเสมอ ซึ่งไม่จำกัดเมื่อเวลาผ่านไป หากต้องการปลดล็อกเรียลไทม์และการเล่นพร้อมกันหลายเกม อัปเกรดเป็น BGA Premium ได้ที่นี่: {link} ขอบคุณที่เข้าใจ และขอให้โชคดี!",
  "vi": "Xin lỗi! Các ván thời gian thực và chơi nhiều ván cùng lúc dành riêng cho thành viên BGA Premium, vì thời gian chơi của tôi là nguồn lực có hạn. Thành viên miễn phí luôn có thể chơi với tôi một ván bất đồng bộ (theo lượt) tại một thời điểm, điều này là không giới hạn theo thời gian. Để mở khóa thời gian thực và nhiều ván cùng lúc, hãy nâng cấp lên BGA Premium tại đây: {link} Cảm ơn bạn đã thông cảm và chúc may mắn!",
  "id": "Maaf! Permainan waktu nyata dan beberapa permainan sekaligus hanya untuk anggota BGA Premium, karena waktu bermain saya adalah sumber daya terbatas. Anggota gratis selalu bisa memainkan satu permainan asinkron (bergiliran) dengan saya dalam satu waktu, yang tidak terbatas seiring waktu. Untuk membuka waktu nyata dan permainan bersamaan, tingkatkan ke BGA Premium di sini: {link} Terima kasih atas pengertiannya dan semoga berhasil!",
  "ms": "Maaf! Permainan masa nyata dan beberapa permainan serentak dikhaskan untuk ahli BGA Premium, kerana masa bermain saya ialah sumber yang terhad. Ahli percuma sentiasa boleh bermain satu permainan tak segerak (giliran) dengan saya pada satu masa, yang tidak terhad dari semasa ke semasa. Untuk membuka masa nyata dan permainan serentak, naik taraf ke BGA Premium di sini: {link} Terima kasih atas kefahaman anda dan semoga berjaya!",
  "fi": "Anteeksi! Reaaliaikaiset pelit ja useat pelit yhtä aikaa on varattu BGA Premium -jäsenille, koska peliaikani on rajallinen voimavara. Ilmaiset jäsenet voivat aina pelata kanssani yhden asynkronisen (vuoropohjaisen) pelin kerrallaan, mikä on ajallisesti rajatonta. Avataksesi reaaliaikaiset ja samanaikaiset pelit, päivitä BGA Premiumiin täältä: {link} Kiitos ymmärryksestäsi ja onnea matkaan!",
  "sv": "Förlåt! Spel i realtid och flera spel samtidigt är reserverade för BGA Premium-medlemmar, eftersom min speltid är en begränsad resurs. Gratismedlemmar kan alltid spela ett asynkront (turbaserat) spel med mig åt gången, vilket är obegränsat över tid. För att låsa upp realtid och samtidiga spel, uppgradera till BGA Premium här: {link} Tack för din förståelse och lycka till!",
  "no": "Beklager! Sanntidsspill og flere spill samtidig er forbeholdt BGA Premium-medlemmer, fordi spilletiden min er en begrenset ressurs. Gratismedlemmer kan alltid spille ett asynkront (turbasert) spill med meg om gangen, noe som er ubegrenset over tid. For å låse opp sanntid og samtidige spill, oppgrader til BGA Premium her: {link} Takk for forståelsen, og lykke til!",
  "da": "Undskyld! Realtidsspil og flere spil på én gang er forbeholdt BGA Premium-medlemmer, fordi min spilletid er en begrænset ressource. Gratismedlemmer kan altid spille ét asynkront (turbaseret) spil med mig ad gangen, hvilket er ubegrænset over tid. For at låse op for realtid og samtidige spil, opgrader til BGA Premium her: {link} Tak for din forståelse, og held og lykke!",
  "ca": "Ho sento! Les partides en temps real i diverses partides alhora estan reservades als membres BGA Premium, perquè el meu temps de joc és un recurs limitat. Els membres gratuïts sempre poden jugar amb mi una partida asíncrona (per torns) cada vegada, cosa que és il·limitada amb el temps. Per desbloquejar el temps real i les partides simultànies, passa a BGA Premium aquí: {link} Gràcies per la teva comprensió i bona sort!",
  "gl": "Síntoo! As partidas en tempo real e varias partidas á vez están reservadas aos membros BGA Premium, porque o meu tempo de xogo é un recurso limitado. Os membros gratuítos sempre poden xogar comigo unha partida asíncrona (por quendas) de cada vez, o que é ilimitado co tempo. Para desbloquear o tempo real e as partidas simultáneas, pasa a BGA Premium aquí: {link} Grazas pola túa comprensión e boa sorte!",
  "br": "Digarez! Ar c'hoarioù war-eeun ha meur a c'hoari war un dro a zo miret evit izili BGA Premium, rak un danvez bevennet eo va amzer c'hoari. Gallout a ra an izili digoust c'hoari ganin ur c'hoari dizenkronel (dre zroioù) bep tro, ar pezh a zo hep bevenn en amzer. Evit dibrennañ ar c'hoari war-eeun hag ar c'hoarioù war un dro, tremen da BGA Premium amañ: {link} Trugarez evit ho komprenezon, ha chañs vat!",
  "be": "Прабачце! Гульні ў рэальным часе і некалькі гульняў адначасова даступныя толькі ўдзельнікам BGA Premium, бо мой час гульні абмежаваны рэсурс. Бясплатныя ўдзельнікі заўсёды могуць гуляць са мной у адну асінхронную (пакрокавую) гульню за раз, і гэта неабмежавана ў часе. Каб адкрыць рэальны час і адначасовыя гульні, перайдзіце на BGA Premium тут: {link} Дзякуй за разуменне і поспехаў!",
  "et": "Vabandust! Reaalajas mängud ja mitu mängu korraga on mõeldud BGA Premium liikmetele, sest minu mänguaeg on piiratud ressurss. Tasuta liikmed saavad alati minuga korraga mängida ühe asünkroonse (käigupõhise) mängu, mis on ajas piiramatu. Reaalaja ja samaaegsete mängude avamiseks uuenda siin BGA Premiumiks: {link} Tänan mõistmast ja edu!",
  "lt": "Atsiprašau! Žaidimai realiu laiku ir keli žaidimai vienu metu skirti tik BGA Premium nariams, nes mano žaidimo laikas yra ribotas išteklius. Nemokami nariai visada gali su manimi žaisti vieną asinchroninį (ėjimais grįstą) žaidimą vienu metu, o tai laikui bėgant neribota. Norėdami atrakinti realų laiką ir vienalaikius žaidimus, pereikite prie BGA Premium čia: {link} Ačiū už supratimą ir sėkmės!",
  "lv": "Atvainojos! Reāllaika spēles un vairākas spēles vienlaikus ir paredzētas BGA Premium dalībniekiem, jo mans spēlēšanas laiks ir ierobežots resurss. Bezmaksas dalībnieki vienmēr var spēlēt ar mani vienu asinhrono (gājienu) spēli vienlaikus, kas laika gaitā ir neierobežota. Lai atbloķētu reāllaiku un vienlaicīgas spēles, jaunini uz BGA Premium šeit: {link} Paldies par sapratni un veiksmi!",
};
// Merge the consolidated premium-gate strings into TRANSLATIONS so `t()`
// resolves them like any other key (English remains the fallback for any
// locale not covered here).
for (const [lang, msg] of Object.entries(PREMIUM_GATE)) {
  (TRANSLATIONS[lang] ??= {}).premiumGate = msg;
}

/**
 * Appended to the premium-gate nudge ONLY for the async-limit case, to point
 * the free member at the one async game they're allowed to keep (their oldest
 * active async game with the bot). "{gameLink}" is a direct BGA table URL.
 * One consolidated map across all 41 languages, merged into TRANSLATIONS like
 * premiumGate above. No em-dashes anywhere.
 */
const PREMIUM_GATE_ASYNC_OTHER: Record<string, string> = {
  "en": "Please finish this game before starting another async game: {gameLink}",
  "fr": "Merci de terminer cette partie avant d'en commencer une autre en asynchrone : {gameLink}",
  "es": "Por favor, termina esta partida antes de empezar otra partida asíncrona: {gameLink}",
  "pt": "Por favor, termina esta partida antes de começar outra partida assíncrona: {gameLink}",
  "it": "Per favore, finisci questa partita prima di iniziarne un'altra in asincrono: {gameLink}",
  "de": "Bitte beende diese Partie, bevor du eine weitere asynchrone Partie startest: {gameLink}",
  "nl": "Maak dit spel alsjeblieft af voordat je een ander asynchroon spel start: {gameLink}",
  "ru": "Пожалуйста, завершите эту игру, прежде чем начинать ещё одну асинхронную игру: {gameLink}",
  "uk": "Будь ласка, завершіть цю гру, перш ніж починати ще одну асинхронну гру: {gameLink}",
  "pl": "Proszę, dokończ tę grę, zanim zaczniesz kolejną grę asynchroniczną: {gameLink}",
  "cs": "Prosím, dokonči tuto hru, než začneš další asynchronní hru: {gameLink}",
  "sk": "Prosím, dokonči túto hru, než začneš ďalšiu asynchrónnu hru: {gameLink}",
  "sl": "Prosim, dokončaj to igro, preden začneš novo asinhrono igro: {gameLink}",
  "sr": "Молим те, заврши ову игру пре него што започнеш још једну асинхрону игру: {gameLink}",
  "hr": "Molim te, završi ovu igru prije nego što započneš još jednu asinkronu igru: {gameLink}",
  "bg": "Моля, завърши тази игра, преди да започнеш още една асинхронна игра: {gameLink}",
  "ro": "Te rog termină acest joc înainte de a începe alt joc asincron: {gameLink}",
  "hu": "Kérlek, fejezd be ezt a játékot, mielőtt új aszinkron játékot kezdesz: {gameLink}",
  "el": "Παρακαλώ τελείωσε αυτό το παιχνίδι πριν ξεκινήσεις άλλο ασύγχρονο παιχνίδι: {gameLink}",
  "tr": "Lütfen başka bir asenkron oyuna başlamadan önce bu oyunu bitir: {gameLink}",
  "ar": "من فضلك أنهِ هذه المباراة قبل أن تبدأ مباراة غير متزامنة أخرى: {gameLink}",
  "he": "אנא סיים את המשחק הזה לפני שתתחיל משחק אסינכרוני נוסף: {gameLink}",
  "fa": "لطفاً این بازی را تمام کنید پیش از آنکه بازی ناهم‌زمان دیگری شروع کنید: {gameLink}",
  "ja": "別の非同期対局を始める前に、まずこの対局を終えてください：{gameLink}",
  "ko": "다른 비동기 게임을 시작하기 전에 이 게임을 먼저 끝내 주세요: {gameLink}",
  "zh": "开始另一盘异步对局之前，请先下完这一盘：{gameLink}",
  "th": "กรุณาเล่นเกมนี้ให้จบก่อนเริ่มเกมแบบอะซิงโครนัสเกมใหม่: {gameLink}",
  "vi": "Vui lòng hoàn thành ván này trước khi bắt đầu một ván bất đồng bộ khác: {gameLink}",
  "id": "Tolong selesaikan permainan ini sebelum memulai permainan asinkron lain: {gameLink}",
  "ms": "Sila habiskan permainan ini sebelum memulakan permainan tak segerak yang lain: {gameLink}",
  "fi": "Pelaa tämä peli loppuun ennen kuin aloitat uuden asynkronisen pelin: {gameLink}",
  "sv": "Spela klart det här spelet innan du börjar ett nytt asynkront spel: {gameLink}",
  "no": "Fullfør dette spillet før du starter et nytt asynkront spill: {gameLink}",
  "da": "Gør venligst dette spil færdigt, før du starter et nyt asynkront spil: {gameLink}",
  "ca": "Si us plau, acaba aquesta partida abans de començar-ne una altra d'asíncrona: {gameLink}",
  "gl": "Por favor, remata esta partida antes de comezar outra partida asíncrona: {gameLink}",
  "br": "Mar plij, echu ar c'hoari-mañ a-raok kregiñ gant ur c'hoari dizenkronel all: {gameLink}",
  "be": "Калі ласка, завяршыце гэтую гульню, перш чым пачынаць яшчэ адну асінхронную гульню: {gameLink}",
  "et": "Palun lõpeta see mäng enne uue asünkroonse mängu alustamist: {gameLink}",
  "lt": "Prašome baigti šį žaidimą prieš pradedant kitą asinchroninį žaidimą: {gameLink}",
  "lv": "Lūdzu, pabeidz šo spēli, pirms sāc citu asinhrono spēli: {gameLink}",
};
for (const [lang, msg] of Object.entries(PREMIUM_GATE_ASYNC_OTHER)) {
  (TRANSLATIONS[lang] ??= {}).premiumGateAsyncOther = msg;
}

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
