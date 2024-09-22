const { OllamaEmbeddings } = require("@langchain/ollama");
const { createClient } = require('redis');
const { RedisVectorStore } = require('@langchain/redis');
const { Document } = require('@langchain/core/documents');
const axios = require('axios');
const fs = require("fs");
require('dotenv').config();


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

//async function createIndex() {
//    await client.ft.create('embeddingIdx', {
//        '$.embedding': {
//            type: 'VECTOR',
//            ALGORITHM: 'HNSW',
//            M: 16,
//            EF_CONSTRUCTION: 200,
//            EF_RUNTIME: 10,
//            DIM: 4096,  //1536 Dimension of OpenAI embeddings
//        },
//    });
//}

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
                        metadata: { title: d.title },
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

(async () => {

    await initializeRedis();

    let docs = [];

    try {
        docs = await getDocuments();

    }catch (error) {
        console.log('cannot read the documents');
        console.error(error);
        return;
    }

    const embeddings = new OllamaEmbeddings({
        model: process.env.MODEL_NAME,
        baseUrl: process.env.OLLAMA_URL,

    });

    const vectorStore = await RedisVectorStore.fromDocuments(
        docs,
        embeddings,
        {
            redisClient: client,
            indexName: 'docs'
        });

    console.log("Documents stored in Redis with embeddings.\n\n");

    const query = "What excercise should I do while pregnant?";
    
    const results = await vectorStore.similaritySearch(query, 3);

    //console.log("Search Results:", results);

    // Generate a user-friendly response using LLaMA model based on search results
    if (results.length > 0) {
        const context = results.map(result => result.pageContent).join("\n");

        // Generate a response using the LLaMA model (assumed to be available through Ollama)
        const responsePrompt = `Based on the following information:\n${context}\n\nAnswer this question: ${query}`;

        // Generate response using the LLaMA model via Ollama API
        try {
            const response = await axios.post(`${process.env.OLLAMA_URL}/api/generate`, {
                prompt: responsePrompt,
                model: process.env.MODEL_NAME, // Specify your model here
                max_tokens: 150, // Adjust as needed
                stream: false
            });

            const response_text = response.data.response;

            console.log("\n\n-----------------------------------\n\n");

            console.log("Generated Response:\n\n", response_text, "\n\n"); 
            
            console.log("\n\n-----------------------------------\n\n");
           
            // delete the index
            await deleteKeysByPattern("doc:*");
        } catch (error) {
            console.error("Error generating response:", error);
        }
        
    } else {
        console.log("No relevant documents found.");
    }

    await client.disconnect();
})();


