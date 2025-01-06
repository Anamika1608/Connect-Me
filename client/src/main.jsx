import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import VideoStream from './component/video.jsx'
import Home from './component/home.jsx'
import {
  createBrowserRouter,
  RouterProvider,
  Route,
  createRoutesFromElements,

} from "react-router-dom";

const router = createBrowserRouter(
  createRoutesFromElements(

    <Route path='/' element={<App />}>
      <Route path="" element={<Home />} />
      <Route path="videoStream/:roomName" element={<VideoStream />} />
    </Route>

  )
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <RouterProvider router={router} />
)