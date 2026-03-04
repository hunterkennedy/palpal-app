-- PODCASTS
INSERT INTO podcasts (id, display_name, description, image, theme, social_sections, enabled, display_order)
VALUES
    (
        'pal',
        'Podcast About List',
        'The most intelligent search engine for the most intelligent podcast',
        '/pal.webp',
        '{"primary":"orange-500","secondary":"orange-400","accent":"orange-600","gradientFrom":"orange-900","gradientTo":"orange-800"}',
        '[{"title":"Podcast About List","titleColor":"bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"Youtube","link":"https://www.youtube.com/@PodcastAboutList","icon":"YouTube","hoverColor":"hover:text-red-400"},{"site":"patreon","title":"Patreon","link":"https://patreon.com/podcastaboutlist","icon":"Patreon","hoverColor":"hover:text-orange-400"},{"site":"twitch","title":"Twitch","link":"https://www.twitch.tv/podcastaboutlist","icon":"Twitch","hoverColor":"hover:text-purple-400"},{"site":"website","title":"Swagpoop","link":"https://swagpoop.com","icon":"Website","hoverColor":"hover:text-green-700"}]}]',
        TRUE,
        1
    ),
    (
        'joe-box',
        'Joe Box',
        'The greatest gameshow on Youtube',
        '/joe-box.png',
        '{"primary":"yellow-500","secondary":"yellow-400","accent":"yellow-600","gradientFrom":"yellow-900","gradientTo":"yellow-800"}',
        '[{"title":"Joe Box","titleColor":"bg-gradient-to-r from-yellow-500 to-yellow-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"JOE GLEASON","link":"https://www.youtube.com/@joegleasontv","icon":"YouTube","hoverColor":"hover:text-red-400"},{"site":"patreon","title":"Joe Box Patreon","link":"https://www.patreon.com/joebox","icon":"Patreon","hoverColor":"hover:text-orange-400"},{"site":"youtube","title":"home planet video","link":"https://www.youtube.com/@homeplanetvideo","icon":"YouTube","hoverColor":"hover:text-red-400"}]}]',
        TRUE,
        2
    ),
    (
        'fear-and',
        'Fear&',
        'Existential dread meets comedy',
        '/fear-and.jpg',
        '{"primary":"red-500","secondary":"red-400","accent":"red-600","gradientFrom":"red-900","gradientTo":"red-800"}',
        '[{"title":"Fear&","titleColor":"bg-gradient-to-r from-red-500 to-red-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"@FearAndPodcast","link":"https://www.youtube.com/@FearAndPodcast","icon":"YouTube","hoverColor":"hover:text-red-400"},{"site":"patreon","title":"Fear& Patreon","link":"https://www.patreon.com/c/fearand","icon":"Patreon","hoverColor":"hover:text-red-400"}]}]',
        TRUE,
        3
    ),
    (
        'the-yard',
        'The Yard',
        'Four friends talking about nothing and everything',
        '/the-yard.jpg',
        '{"primary":"green-500","secondary":"green-400","accent":"green-600","gradientFrom":"green-900","gradientTo":"green-800"}',
        '[{"title":"The Yard","titleColor":"bg-gradient-to-r from-green-500 to-green-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"@TheYardPodcast","link":"https://www.youtube.com/@theyardpodcast","icon":"YouTube","hoverColor":"hover:text-red-400"},{"site":"twitch","title":"The Yard Twitch","link":"https://www.twitch.tv/theyardpodcast","icon":"Twitch","hoverColor":"hover:text-purple-400"}]}]',
        TRUE,
        4
    ),
    (
        'wine-about-it',
        'Wine About It',
        'Wine, whining, and everything in between',
        '/wine-about-it.png',
        '{"primary":"purple-500","secondary":"purple-400","accent":"purple-600","gradientFrom":"purple-900","gradientTo":"purple-800"}',
        '[{"title":"Wine About It","titleColor":"bg-gradient-to-r from-purple-500 to-purple-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"@WineAboutItPod","link":"https://www.youtube.com/@wineaboutitpod","icon":"YouTube","hoverColor":"hover:text-red-400"},{"site":"patreon","title":"Wine About It Patreon","link":"https://patreon.com/wineaboutit","icon":"Patreon","hoverColor":"hover:text-purple-400"}]}]',
        TRUE,
        5
    ),
    (
        'joy-tactics',
        'Joy Tactics',
        'Tactical joy and strategic happiness',
        '/joy_tactics.jpeg',
        '{"primary":"yellow-500","secondary":"yellow-400","accent":"yellow-600","gradientFrom":"yellow-900","gradientTo":"yellow-800"}',
        '[{"title":"Joy Tactics","titleColor":"bg-gradient-to-r from-yellow-500 to-yellow-400 bg-clip-text text-transparent","links":[{"site":"youtube","title":"Joy Tactics","link":"https://www.youtube.com/@joytactics","icon":"YouTube","hoverColor":"hover:text-red-400"}]}]',
        TRUE,
        6
    )
ON CONFLICT (id) DO NOTHING;

-- SOURCES
-- max_new caps how many new episodes are queued per discovery run.
-- Prevents a fresh DB (or a new source) from spawning hundreds of workflows at once.
-- Remove max_new from a source once its backlog has been intentionally processed.
INSERT INTO sources (podcast_id, name, site, type, url, fetch_url, description, filters, enabled)
VALUES
    -- pal
    (
        'pal', 'PALYoutubePlaylist', 'youtube', 'playlist',
        'https://youtu.be/to1SiPIV41c?list=PL5B0Y8l1lpJoXIvq-qr5eD0OfD2McKB_o',
        NULL, NULL, '{"max_new": 1}', TRUE
    ),
    (
        'pal', 'PALPatreon', 'patreon', 'user',
        'https://www.patreon.com/podcastaboutlist',
        'https://www.patreon.com/collection/868040',
        NULL, '{"max_new": 1}', TRUE
    ),
    -- joe-box
    (
        'joe-box', 'JoeBoxSeason1', 'youtube', 'playlist',
        'https://youtu.be/nl_1HxPRQPY?list=PLXyeAGcWg3Gahw48EXoRHY297G-0d-7CL',
        NULL, 'Season 1', '{"max_new": 1}', TRUE
    ),
    (
        'joe-box', 'JoeBoxSeason2', 'youtube', 'playlist',
        'https://youtu.be/H9QCuVAnP2w?list=PLXyeAGcWg3GZdKX4Facr6yxEdj39LEdXe',
        NULL, 'Season 2', '{"max_new": 1}', TRUE
    ),
    -- fear-and
    (
        'fear-and', 'FearAndYoutubePlaylist', 'youtube', 'playlist',
        'https://youtu.be/1YOIMoHF798?list=PLmijiMQBvw1LGakNWhfCedRxPD_apQ1H1',
        NULL, NULL, '{"max_new": 1}', TRUE
    ),
    -- the-yard
    (
        'the-yard', 'TheYardYoutubePlaylist', 'youtube', 'playlist',
        'https://youtu.be/pBKAkrBrdkc?list=PLtiWkKVZkCXVu_3pkKsQviOZ7r_9b39JN',
        NULL, NULL, '{"max_new": 1}', TRUE
    ),
    -- wine-about-it
    (
        'wine-about-it', 'WineAboutItYoutubePlaylist', 'youtube', 'playlist',
        'https://youtu.be/XWx6XJ2lk4s?list=PLpUEJXG2zlWQA3VOUFwUQXIrrs4zrBNDI',
        NULL, NULL, '{"max_new": 1}', TRUE
    ),
    -- joy-tactics
    (
        'joy-tactics', 'JoyTacticsYoutubeChannel', 'youtube', 'channel',
        'https://www.youtube.com/@joytactics',
        NULL, NULL, '{"title_exclude": ["teaser"], "max_new": 1}', TRUE
    )
ON CONFLICT (podcast_id, name) DO NOTHING;
