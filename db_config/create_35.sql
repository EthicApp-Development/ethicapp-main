create table if not exists institucion(
    id serial,
    userid integer references users(id),
    nombreinstitucion text,
    numestudiantes int,
    pais text,
    dominionscorreo text,
    cargo text
);
