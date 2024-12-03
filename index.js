const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const { admin, db } = require("./firebase-config");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ativar CORS
app.use(
  cors({
    origin: [
      "https://recipeshareweb.vercel.app",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// Rota OPTIONS para CORS
app.options("*", cors());

app.use(morgan("dev"));

//Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware para JWT do Firebase
async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log("Cabeçalho de autorização:", authHeader);

  const token = authHeader?.split(" ")[1];
  if (!token) {
    return res.status(403).send({ error: "Token não fornecido" });
  }
  try {
    //Verifica o token com o Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;

    next();
  } catch (error) {
    console.log(`/authenticate ${error}`);
    console.error("Erro ao validar token:", error.message);
    res.status(401).send({ error: "Token inválido ou expirado" });
  }
}

// Rota para consultas de receitas do usuario atual em conjunto
app.get("/recipes", authenticateJWT, async (req, res) => {
  try {
    const snapshot = await db
      .collection("recipes")
      .where("userId", "==", req.user.uid)
      .get();

    // Criação de um array de receitas com username do criador
    const recipes = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const recipeData = doc.data();
        const userRef = db.collection("users").doc(recipeData.userId);
        const userDoc = await userRef.get();

        const username = userDoc.exists
          ? userDoc.data().username
          : "Desconhecido";

        return { id: doc.id, ...recipeData, username }; // Adiciona o username
      })
    );

    res.send(recipes);
  } catch (error) {
    console.log(`/consulta user atual ${error}`);
    res.status(400).send({ error: error.message });
  }
});

// Rota para consultar em conjunto todas as receitas de todos os usuários
app.get("/recipes/all", authenticateJWT, async (req, res) => {
  try {
    const snapshot = await db.collection("recipes").get(); // Não filtra por userId

    const recipes = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const recipeData = doc.data();
        const userRef = db.collection("users").doc(recipeData.userId);
        const userDoc = await userRef.get();

        const username = userDoc.exists
          ? userDoc.data().username
          : "Desconhecido";

        return { id: doc.id, ...recipeData, username };
      })
    );

    res.send(recipes);
  } catch (error) {
    console.log(`/consulta geral ${error}`);
    res.status(400).send({ error: error.message });
  }
});

// Rota para consultar receita por ID
app.get("/recipes/:id", authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const recipeDoc = await db.collection("recipes").doc(id).get();

    if (!recipeDoc.exists) {
      return res.status(404).send({ error: "Receita não encontrada." });
    }

    const recipeData = recipeDoc.data();
    const userRef = db.collection("users").doc(recipeData.userId);
    const userDoc = await userRef.get();

    const username = userDoc.exists ? userDoc.data().username : "Desconhecido"; // Caso não encontre o usuário

    // Responde com a receita e o username
    res.status(200).send({ id: recipeDoc.id, ...recipeData, username });
  } catch (error) {
    console.log(`/consulta ID ${error}`);
    res.status(500).send({ error: error.message });
  }
});

//Rota para adicionar receita
app.post("/recipes", authenticateJWT, async (req, res) => {
  try {
    const recipe = {
      ...req.body,
      userId: req.user.uid,
    };
    const docRef = await db.collection("recipes").add(recipe);
    res.status(201).send({ id: docRef.id, ...recipe });
  } catch (error) {
    console.log(`/add ${error}`);
    res
      .status(400)
      .send({ error: "rota de addRecipes", details: error.message });
  }
});

//Rota para atualizar receita
app.put("/recipes/:id", authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    await db.collection("recipes").doc(id).update(req.body);
    res.status(200).send({ id, ...req.body });
  } catch (error) {
    console.log(`/update ${error}`);
    res.status(400).send({ error: error.message });
  }
});

// Rota para deletar receita
app.delete("/recipes/:id", authenticateJWT, async (req, res) => {
  const { id } = req.params; // ID da receita a ser deletada
  try {
    const recipeDoc = await db.collection("recipes").doc(id).get();
    //Verifica se a receita existe
    if (!recipeDoc.exists) {
      return res.status(404).send({ error: "Receita não encontrada" });
    }
    //Verifica se o usuário é o dono da receita
    if (recipeDoc.data().userId !== req.user.uid) {
      return res.status(403).send({ error: "Permissão negada" });
    }
    await db.collection("recipes").doc(id).delete();
    res.status(200).send({ message: "Receita deletada com sucesso" });
  } catch (error) {
    console.log(`/delete ${error}`);
    console.error("Erro ao deletar receita:", error.message);
    res
      .status(400)
      .send({ error: "Erro ao deletar receita", details: error.message });
  }
});

// Rota para cadastro de nome de usuário
app.post("/register", authenticateJWT, async (req, res) => {
  const { username, email } = req.body;

  if (!email || !username) {
    return res.status(400).send({ error: "Email e username são obrigatórios" });
  }

  try {
    // Verifica se o usuário já está registrado no Firestore
    const userRef = db.collection("users").doc(req.user.uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      return res.status(400).send({ error: "Usuário já cadastrado" });
    }

    // Salvar dados adicionais do usuário no Firestore
    await userRef.set({
      username,
      email,
    });

    res.status(201).send({
      message: "Usuário registrado com sucesso no Firestore",
      userId: req.user.uid,
    });
  } catch (error) {
    console.log(`/register ${error}`);
    console.error("Erro ao cadastrar usuário:", error.message);
    res
      .status(400)
      .send({ error: "Erro ao cadastrar usuário", details: error.message });
  }
});

//Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
