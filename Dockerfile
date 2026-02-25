FROM libretranslate/libretranslate:latest

EXPOSE 8080

CMD ["libretranslate", "--host", "0.0.0.0", "--port", "8080"]
