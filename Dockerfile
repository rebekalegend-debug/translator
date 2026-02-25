FROM libretranslate/libretranslate:latest

CMD ["--host", "0.0.0.0", "--port", "3000", "--disable-web-ui"]
