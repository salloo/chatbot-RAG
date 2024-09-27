const { OllamaEmbeddings } = require("@langchain/ollama");
const { createClient } = require('redis');
const { RedisVectorStore } = require('@langchain/redis');
const { Document } = require('@langchain/core/documents');
const axios = require('axios');
const fs = require("fs");
const express = require('express');
require('dotenv').config();

// TODO: Improvements
// Document file loaders / PDF / unstructured / html (https://python.langchain.com/docs/integrations/document_loaders/unstructured_file)
// Text splitters  (https://python.langchain.com/docs/modules/data_connection/document_transformers/text_splitters/recursive_text_splitter)
// Prompt engineering
// Remember user session
// Dockerize 

let vectorStore = null;
const knn = 3;

// Create an Express app
const app = express();

// Middleware to parse JSON bodies in requests
app.use(express.json());

// Define a port (you can use an environment variable or a default value)
const port = process.env.PORT || 3000;

app.get('/api/reindex', async (req, res) => {
    await reindexDB();
    res.json({ success: true, data: {message: 'reindexed'} });
});

// Example API route that returns some data
app.post('/api/chat', async (req, res) => {

    const body = req.body;
    let response = await queryModel(body.query);

    res.json({ success: true, data: {message: response} });
});

// Start the server
app.listen(port, async () => {
    await initializeRedis();
    await reindexDB();
    
    console.log(`Server running on port ${port}`);
});

// ----------------------------Chatbot functions-----------------------------------//

async function reindexDB() {
    await deleteKeysByPattern('doc:*');
    docs = await getDocuments();

    const embeddings = new OllamaEmbeddings({
        model: process.env.MODEL_NAME,
        baseUrl: process.env.OLLAMA_URL,
    });

    vectorStore = await RedisVectorStore.fromDocuments(
        docs,
        embeddings,
        {
            redisClient: client,
            indexName: process.env.INDEX_NAME,
        });
}

async function initializeRedis() {
  return new Promise((resolve, reject) => {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000  // Optional: Customize the connection timeout (10 seconds)
      }
    });

    // Handle Redis connection events
    client.on('connect', () => {
      console.log('Redis client connected');
      resolve(client);
    });

    client.on('error', (err) => {
      console.error('Redis error: ', err);
      reject(err);
    });

    client.connect();  // Initiates the connection
  });
}

async function getDocuments() {
    return new Promise((resolve, reject) => {
        fs.readFile("./docs.json", 'utf8', (err, data) => {
            if (err) {
                return reject(err); // Reject the promise if there's an error
            }
            try {
                let documents = [];
                let docs = JSON.parse(data); // Parse JSON data
                
                for (let i = 0; i < docs.length; i++) {
                    let d = docs[i];
                    documents.push(new Document({
                        id: i,
                        metadata: { title: d.title, url: d.url },
                        pageContent: d.content,
                    }));
                } 
                resolve(documents); // Resolve with parsed data
            } catch (parseErr) {
                reject(parseErr); // Reject if parsing fails
            }
        });
    });
}

async function queryModel(query) {

    console.log(`searching store for: ${query}`);

    const results = await vectorStore.similaritySearch(query, knn);

    if (results.length > 0) {

        console.log("\nmatched docs\n:");
        results.map(r => console.log(r.metadata.title));
        const context = results.map(result => result.pageContent).join("\n");

        // Generate a response using the LLaMA model (assumed to be available through Ollama)
        const responsePrompt = `Based on the following information:\n${context}\n\nAnswer this question: ${query}`;

        // Generate response using the LLaMA model via Ollama API
        try {
            const response = await axios.post(`${process.env.OLLAMA_URL}/api/generate`, {
                prompt: responsePrompt,
                model: process.env.MODEL_NAME, // Specify your model here
                max_tokens: 500, // Adjust as needed
                stream: false
            });

            const response_text = response.data.response;
            return response_text;
        } catch (error) {
            console.error(error);
            return "Error generating response:", error;
        }
        
    } else {
        return "No relevant documents found.";
    }
}

async function deleteKeysByPattern(pattern) {
  try {
    let cursor = '0'; // Initial cursor value for SCAN
    const keysToDelete = [];

    // Use SCAN to find keys matching the pattern
    //do {
      const result = await client.scan(cursor, {
        MATCH: pattern,  // Pattern to match (e.g., prefix*)
        COUNT: 1000      // Number of keys to scan at once
      });

      cursor = result.cursor;   // Update the cursor
      const keys = result.keys; // Get matching keys

      if (keys.length > 0) {
        keysToDelete.push(...keys);
      }
    //} while (cursor !== '0'); // Continue scanning until cursor is 0

    // If there are keys to delete, use DEL or UNLINK
    if (keysToDelete.length > 0) {
      console.log(`Deleting ${keysToDelete.length} keys matching ${pattern}`);
      await client.del(keysToDelete); // You can use redisClient.unlink for non-blocking delete
    } else {
      console.log(`No keys found matching pattern: ${pattern}`);
    }
  } catch (error) {
    console.error('Error deleting keys:', error);
  }
}
