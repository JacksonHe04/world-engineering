UPDATE "oauthClient"
SET
  "redirectUris" = json_array(
    'https://world.inon.space/api/auth/inon/callback',
    'http://localhost:3000/api/auth/inon/callback'
  ),
  "uri" = 'https://world.inon.space',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE json_extract("metadata", '$.project') = 'inon';
