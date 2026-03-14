-- Clear manually-set image paths; icons will be populated from YouTube CDN on next discovery
UPDATE podcasts SET image = '', icon = NULL, icon_content_type = NULL;
