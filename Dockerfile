FROM libretranslate/libretranslate:latest

ENV LT_HOST=0.0.0.0
ENV LT_PORT=8080
ENV LT_DISABLE_WEB_UI=true

EXPOSE 8080
