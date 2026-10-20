const h=require("http"),f=require("fs"),p=require("path");
const root=process.argv[2]||".",port=+(process.argv[3]||8643);
const t={".html":"text/html;charset=utf-8",".css":"text/css",".js":"text/javascript",".json":"application/json",".md":"text/markdown;charset=utf-8"};
h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split("?")[0]);if(u==="/")u="/index.html";f.readFile(p.join(root,u),(e,d)=>{if(e){s.writeHead(404);s.end("404")}else{s.writeHead(200,{"Content-Type":t[p.extname(u)]||"application/octet-stream"});s.end(d)}})}).listen(port,()=>console.log("on",port));
