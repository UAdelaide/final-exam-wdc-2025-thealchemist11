const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs').promises

const app = express();
const port = 3000;

app.use(express.static('public'));

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  multipleStatements: true
};

let db;

async function setupDatabase() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    const dogwalksSQL = await fs.readFile('dogwalks.sql', 'utf-8');
    await connection.query(dogwalksSQL);
    console.log('Database and tables created successfully.');
    
    await connection.end();
    
    db = await mysql.createConnection({
      ...dbConfig,
      database: 'DogWalkService'
    });

    console.log('Connected to DogWalkService database.');

    const [users] = await db.execute('SELECT COUNT(*) as count FROM Users');
    
    if (users[0].count === 0) {
      console.log('No data found. Seeding database...');
      
      await db.execute(`
        INSERT INTO Users (username, email, password_hash, role) VALUES
        ('alice123', 'alice@example.com', 'hashed123', 'owner'),
        ('bobwalker', 'bob@example.com', 'hashed456', 'walker'),
        ('carol123', 'carol@example.com', 'hashed789', 'owner'),
        ('david_w', 'david@example.com', 'hashedabc', 'walker'),
        ('emily_o', 'emily@example.com', 'hasheddef', 'owner');
      `);

      await db.execute(`
        INSERT INTO Dogs (name, size, owner_id) VALUES
        ('Max', 'medium', (SELECT user_id FROM Users WHERE username = 'alice123')),
        ('Bella', 'small', (SELECT user_id FROM Users WHERE username = 'carol123')),
        ('Rocky', 'large', (SELECT user_id FROM Users WHERE username = 'alice123')),
        ('Lucy', 'small', (SELECT user_id FROM Users WHERE username = 'emily_o')),
        ('Charlie', 'medium', (SELECT user_id FROM Users WHERE username = 'carol123'));
      `);

      await db.execute(`
        INSERT INTO WalkRequests (dog_id, requested_time, duration_minutes, location, status) VALUES
        ( (SELECT dog_id FROM Dogs WHERE name = 'Max' AND owner_id = (SELECT user_id FROM Users WHERE username = 'alice123')), '2025-06-10 08:00:00', 30, 'Parklands', 'open'),
        ( (SELECT dog_id FROM Dogs WHERE name = 'Bella' AND owner_id = (SELECT user_id FROM Users WHERE username = 'carol123')), '2025-06-10 09:30:00', 45, 'Beachside Ave', 'accepted'),
        ( (SELECT dog_id FROM Dogs WHERE name = 'Rocky' AND owner_id = (SELECT user_id FROM Users WHERE username = 'alice123')), '2025-06-11 17:00:00', 60, 'Green Valley', 'open'),
        ( (SELECT dog_id FROM Dogs WHERE name = 'Lucy' AND owner_id = (SELECT user_id FROM Users WHERE username = 'emily_o')), '2025-06-12 10:00:00', 25, 'City Center', 'completed'),
        ( (SELECT dog_id FROM Dogs WHERE name = 'Charlie' AND owner_id = (SELECT user_id FROM Users WHERE username = 'carol123')), '2025-06-13 14:00:00', 50, 'Lakefront Trail', 'open');
      `);
      
      const [requestResult] = await db.execute("SELECT request_id FROM WalkRequests WHERE dog_id = (SELECT dog_id FROM Dogs WHERE name = 'Lucy')");
      const lucyRequestId = requestResult[0].request_id;
      const [bobResult] = await db.execute("SELECT user_id FROM Users WHERE username = 'bobwalker'");
      const bobId = bobResult[0].user_id;
      const [emilyResult] = await db.execute("SELECT user_id FROM Users WHERE username = 'emily_o'");
      const emilyId = emilyResult[0].user_id;

      await db.execute('INSERT INTO WalkRatings (request_id, walker_id, owner_id, rating, comments) VALUES (?, ?, ?, ?, ?)', [lucyRequestId, bobId, emilyId, 5, 'Bob was fantastic!']);

      console.log('Database seeded successfully.');
    } else {
      console.log('Database already contains data.');
    }

  } catch (error) {
    console.error('Failed to set up database:', error);
    process.exit(1);
  }
}

app.get('/api/dogs', async (req, res) => {
  try {
    const sql = `
      SELECT
        d.name AS dog_name,
        d.size,
        u.username AS owner_username
      FROM Dogs d
      JOIN Users u ON d.owner_id = u.user_id;
    `;
    const [dogs] = await db.query(sql);
    res.json(dogs);
  } catch (err) {
    console.error('Error fetching dogs:', err);
    res.status(500).json({ error: 'Failed to retrieve dogs from the database.' });
  }
});

app.get('/api/walkrequests/open', async (req, res) => {
  try {
    const sql = `
      SELECT
        wr.request_id,
        d.name AS dog_name,
        wr.requested_time,
        wr.duration_minutes,
        wr.location,
        u.username AS owner_username
      FROM WalkRequests wr
      JOIN Dogs d ON wr.dog_id = d.dog_id
      JOIN Users u ON d.owner_id = u.user_id
      WHERE wr.status = 'open';
    `
    const [requests] = await db.query(sql);
    res.json(requests);
  } catch (err) {
    console.error('Error fetching open walk requests:', err);
    res.status(500).json({ error: 'Failed to retrieve open walk requests.' });
  }
});

app.get('/api/walkers/summary', async (req, res) => {
  try {
    const sql = `
      SELECT
          u.username AS walker_username,
          COUNT(DISTINCT wr.rating_id) AS total_ratings,
          AVG(wr.rating) AS average_rating,
          COUNT(DISTINCT CASE WHEN wreq.status = 'completed' THEN wreq.request_id END) AS completed_walks
      FROM
          Users u
      LEFT JOIN
          WalkRatings wr ON u.user_id = wr.walker_id
      LEFT JOIN
          WalkRequests wreq ON u.user_id = (SELECT wa.walker_id FROM WalkApplications wa WHERE wa.request_id = wreq.request_id AND wa.status = 'accepted' LIMIT 1)
      WHERE
          u.role = 'walker'
      GROUP BY
          u.user_id, u.username;
    `;
    const [summary] = await db.query(sql);
    res.json(summary);
  } catch (err) {
    console.error('Error fetching walkers summary:', err);
    res.status(500).json({ error: 'Failed to retrieve walkers summary.' });
  }
});

setupDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Dog Walking API server running at http://localhost:${port}`);
  });
});
